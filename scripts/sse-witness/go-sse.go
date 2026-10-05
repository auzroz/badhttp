// Go SSE-library witness for /sse (docs/spec-sse-witness.md): two clients, go-sse and r3labs-sse. One JSON line per
// (client, flavor) on stdout, in the row shape scripts/sse-witness/curl.sh emits; progress on stderr (success lines end
// in " ok"). Never run it while scripts/smoke.sh runs: one IP, one zone rate limit.
//
// Per (client, flavor): a FRESH library client and a fresh http.Client + http.Transport, GET /sse/{flavor} with default
// parameters. The transport is forced to HTTP/1.1 (TLSNextProto = an empty non-nil map, which is how net/http is told
// not to negotiate h2) and wrapped in a counting http.RoundTripper that is the single place connections are counted:
// it records each response's status, content-type, x-badhttp-flavor, x-badhttp-version, the Last-Event-ID REQUEST
// header, the protocol the response came back on, and (by wrapping the response body) how the connection ended.
//
// The two classes, assigned from the libraries' sources (cached modules, the versions named on every row):
//
//   - go-sse (tmaxmax) is class "eventsource". (*Connection).Connect loops forever: doConnect calls c.read(res.Body, ...)
//     and, when the stream ends for ANY reason (io.EOF included), returns shouldRetry = true wrapped in a
//     *ConnectionError{Reason: "connection to server lost"}; Connect then waits backoff.next() and goes round again,
//     sending Last-Event-ID from c.lastEventID (resetRequest). The server's retry: field is adopted through
//     setRetry -> backoffController.reset(newInterval). Only a ResponseValidator failure (non-200, wrong
//     Content-Type: DefaultValidator) is permanent and makes Connect return.
//   - r3labs/sse/v2 is class "one-shot". (*Client).SubscribeWithContext runs ONE `operation` per response: readLoop
//     sends `erChan <- nil` on io.EOF, operation returns that nil, and backoff.RetryNotify returns nil on a nil
//     result, so the call returns when the response ends. Its default ReconnectStrategy (ExponentialBackOff) re-runs the
//     operation only after an ERROR (not after a clean end), forever, and does not look at the context (the strategy is
//     not a BackOffContext), so this harness installs backoff.StopBackOff: the first error ends the row and Subscribe
//     returns it. A clean end behaves the same under either strategy. The library never adopts retry: (Event.Retry is
//     only passed through), so retry_ms_adopted is null.
//
// How the rows stop: go-sse is stopped from its OnRetry callback (the library saying "this connection ended, I will
// reconnect in D") on every flavor but resume, recorded end "reconnecting"; on resume it is let reconnect until the
// library stops by itself on the 204 (its validator rejects a non-200: end "stopped", the error is recorded too) or
// until 6 connections (end "closed-by-harness"). go-sse's Backoff.Jitter is set to 1e-9 (the library treats its
// documented "-1 = none" as "use the default 0.5"), so that the OnRetry delay is the retry value the library adopted,
// unjittered; if that delay equals the library's own 500 ms initial interval the library did not adopt a server retry
// and retry_ms_adopted is null. r3labs rows end "clean" (Subscribe returned nil) or "error" (it returned an error).
// Every row has a 30 s context (end "harness-timeout") and a watchdog that abandons the row if the library has not
// returned 3 s after that.
//
// A first response without x-badhttp-version is Cloudflare's rate limit, not an observation: the row is retried after
// 12 s, attempts <= 3, and a response that never clears is emitted with no events (never as an observation).
//
// Run from a throwaway module directory that has both libraries (versions are read from that directory's go.mod and
// recorded on every row):
//
//	mkdir -p GOMOD && cd GOMOD && go mod init ssewitness && go get github.com/tmaxmax/go-sse@v0.11.0 github.com/r3labs/sse/v2@v2.10.0
//	cd GOMOD && go run /ABSOLUTE/PATH/TO/scripts/sse-witness/go-sse.go [base]
//
// SSE_FLAVORS="ok cut" limits a dry run; SSE_CLIENTS="go-sse" limits the clients. A published capture runs both in full.
package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"regexp"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	rsse "github.com/r3labs/sse/v2"
	sse "github.com/tmaxmax/go-sse"
	backoff "gopkg.in/cenkalti/backoff.v1"
)

const (
	rowCap        = 30 * time.Second // per-row wall cap (the context)
	watchdogGrace = 3 * time.Second  // how long after the cap a library that has not returned is abandoned
	maxConns      = 6                // resume: stop letting an eventsource-class library reconnect after this many
	dataInline    = 200              // bytes of data recorded verbatim; more and data is cut to 64 chars + length + sha256
)

var allFlavors = []string{"ok", "stall", "cut", "drop", "crlf", "cr", "no-space", "multiline", "comments", "split-utf8", "wrong-type", "error-event", "big", "resume"}

// ---------- row shape (field names exactly as curl.sh) ----------

type clientMeta struct {
	ID                   string `json:"id"`
	Name                 string `json:"name"`
	Role                 string `json:"role"`
	Class                string `json:"class"`
	Version              string `json:"version"`
	Library              string `json:"library"`
	Platform             string `json:"platform"`
	Invocation           string `json:"invocation"`
	ConnectionsCountedBy string `json:"connections_counted_by"`
}

type connRec struct {
	N               int     `json:"n"`
	Status          int     `json:"status"`
	ContentType     string  `json:"content_type"`
	XBadhttpFlavor  string  `json:"x_badhttp_flavor"`
	XBadhttpVersion string  `json:"x_badhttp_version"`
	LastEventIDSent *string `json:"last_event_id_sent"`
	Ended           string  `json:"ended"`
	Error           *string `json:"error"`
}

type eventRec struct {
	Type       string  `json:"type"`
	ID         *string `json:"id"`
	Data       string  `json:"data"`
	DataBytes  int     `json:"data_bytes"`
	DataSHA256 *string `json:"data_sha256"`
}

type errRec struct {
	Message         string  `json:"message"`
	HadData         bool    `json:"had_data"`
	ReadyStateAfter *string `json:"ready_state_after"`
}

type row struct {
	Family          string     `json:"family"`
	ID              string     `json:"id"`
	CorpusID        string     `json:"corpus_id"`
	URL             string     `json:"url"`
	Method          string     `json:"method"`
	Flavor          string     `json:"flavor"`
	Probed          string     `json:"probed"`
	BadhttpVersion  string     `json:"badhttp_version"`
	Client          clientMeta `json:"client"`
	Attempts        int        `json:"attempts"`
	Connections     []connRec  `json:"connections"`
	Events          []eventRec `json:"events"`
	EventsDelivered int        `json:"events_delivered"`
	Errors          []errRec   `json:"errors"`
	End             string     `json:"end"`
	RetryMsAdopted  *int       `json:"retry_ms_adopted"`
	LastEventIDFin  *string    `json:"last_event_id_final"`
	WallMs          int64      `json:"wall_ms"`
}

// ---------- sanitizing ----------

var (
	addrRe      = regexp.MustCompile(`(\b[0-9]{1,3}(\.[0-9]{1,3}){3}(:[0-9]+)?)|(\[[0-9a-fA-F:]+\](:[0-9]+)?)`)
	pathRe      = regexp.MustCompile(`(/(Users|Volumes|private|tmp|home|var|opt|usr|etc|root)/[^\s"':]*)|([A-Za-z]:\\[^\s"']*)`)
	spaceRe     = regexp.MustCompile(`\s+`)
	badWordRe   = regexp.MustCompile(`(?i)\b(correctly|incorrectly|conformant|violates)\b`)
	pathCheckRe = regexp.MustCompile(`/(Users|Volumes|private|tmp|home|var|opt|usr|etc|root)/|[A-Za-z]:\\\\`)
	hostCheckRe = regexp.MustCompile(`(?i)\b[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(com|net|org|io|dev|ai|cloud|app|me|co|xyz|local|lan|internal)\b`)
)

// Error text can carry the resolver's or the local address and, from a library, a path; keep the kind of failure.
func sanitize(s string) string {
	s = addrRe.ReplaceAllString(s, "<addr>")
	s = pathRe.ReplaceAllString(s, "<path>")
	s = strings.TrimSpace(spaceRe.ReplaceAllString(s, " "))
	if rs := []rune(s); len(rs) > 200 {
		s = string(rs[:200])
	}
	return s
}

func ptr[T any](v T) *T { return &v }

// hygiene: a row may carry no filesystem path, no hostname but badhttp.dev, and none of the banned words.
func hygiene(line []byte) error {
	if m := badWordRe.Find(line); m != nil {
		return fmt.Errorf("banned word %q", m)
	}
	if m := pathCheckRe.Find(line); m != nil {
		return fmt.Errorf("filesystem path %q", m)
	}
	for _, m := range hostCheckRe.FindAll(line, -1) {
		if !strings.EqualFold(string(m), "badhttp.dev") {
			return fmt.Errorf("hostname %q", m)
		}
	}
	return nil
}

// ---------- one row's state ----------

type connState struct {
	rec      connRec
	finished bool
}

type run struct {
	flavor string
	url    string
	parent context.Context // the 30 s cap
	ctx    context.Context // what the library gets; cancelled by stop()
	cancel context.CancelFunc

	stopped atomic.Bool // the harness cancelled ctx on purpose

	mu         sync.Mutex
	sealed     bool // the row was abandoned or built; late callbacks are ignored
	conns      []*connState
	events     []eventRec
	errs       []errRec
	protos     map[string]bool
	end        string
	retry      *int
	lastID     *string
	stopReason string
}

func newRun(base, flavor string) *run {
	parent, cancelParent := context.WithTimeout(context.Background(), rowCap)
	ctx, cancel := context.WithCancel(parent)
	return &run{flavor: flavor, url: base + "/sse/" + flavor, parent: parent, ctx: ctx, protos: map[string]bool{},
		cancel: func() { cancel(); cancelParent() }}
}

func (r *run) timedOut() bool { return errors.Is(r.parent.Err(), context.DeadlineExceeded) }

func (r *run) stop() { r.stopped.Store(true); r.cancel() }

func (r *run) addEvent(typ string, id *string, data string) {
	if typ == "" {
		typ = "message"
	}
	e := eventRec{Type: typ, ID: id, Data: data, DataBytes: len(data)}
	if len(data) > dataInline {
		sum := sha256.Sum256([]byte(data))
		e.DataSHA256 = ptr(hex.EncodeToString(sum[:]))
		e.Data = string([]rune(data)[:64])
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.sealed {
		r.events = append(r.events, e)
	}
}

func (r *run) addErr(err error) {
	msg := sanitize(err.Error())
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.sealed {
		r.errs = append(r.errs, errRec{Message: msg, HadData: false, ReadyStateAfter: nil})
	}
}

func (r *run) setEnd(e string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.sealed {
		r.end = e
	}
}

func (r *run) connCount() int { r.mu.Lock(); defer r.mu.Unlock(); return len(r.conns) }

func (r *run) lastConn() (connRec, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.conns) == 0 {
		return connRec{}, false
	}
	return r.conns[len(r.conns)-1].rec, true
}

// how a connection that did not end by the server closing it ended, judged from the error the library's read saw
func (r *run) classify(err error) (string, *string) {
	switch {
	case r.timedOut():
		return "harness-timeout", ptr(sanitize(err.Error()))
	case r.stopped.Load() || errors.Is(err, context.Canceled):
		return "client-closed", nil
	}
	return "reset", ptr(sanitize(err.Error()))
}

func (r *run) addConn(rec connRec) *connState {
	r.mu.Lock()
	defer r.mu.Unlock()
	cs := &connState{rec: rec}
	cs.rec.N = len(r.conns) + 1
	if rec.Ended != "" {
		cs.finished = true
	}
	if !r.sealed {
		r.conns = append(r.conns, cs)
	}
	return cs
}

// ---------- the counting RoundTripper and its body ----------

type counting struct {
	r  *run
	rt http.RoundTripper
}

func (c *counting) RoundTrip(req *http.Request) (*http.Response, error) {
	r := c.r
	var sent *string
	if v := req.Header.Values("Last-Event-ID"); len(v) > 0 {
		sent = ptr(v[0])
	}
	resp, err := c.rt.RoundTrip(req)
	if err != nil {
		ended, _ := r.classify(err)
		if ended == "reset" {
			ended = "error" // no response at all: a failed request, not a reset stream
		}
		cs := r.addConn(connRec{Status: 0, LastEventIDSent: sent, Ended: ended, Error: ptr(sanitize(err.Error()))})
		if cs.rec.N == 1 {
			r.stop() // nothing to observe; the row is retried or recorded as failed
		}
		return nil, err
	}
	rec := connRec{Status: resp.StatusCode, ContentType: resp.Header.Get("Content-Type"), XBadhttpFlavor: resp.Header.Get("X-Badhttp-Flavor"),
		XBadhttpVersion: resp.Header.Get("X-Badhttp-Version"), LastEventIDSent: sent}
	if resp.StatusCode == http.StatusNoContent {
		rec.Ended = "status-204"
	}
	r.mu.Lock()
	r.protos[resp.Proto] = true
	r.mu.Unlock()
	cs := r.addConn(rec)
	if cs.rec.N == 1 && rec.XBadhttpVersion == "" {
		r.stop() // Cloudflare's rate limit (or something that is not badhttp): not an observation
	}
	resp.Body = &body{rc: resp.Body, r: r, cs: cs}
	return resp, nil
}

type body struct {
	rc io.ReadCloser
	r  *run
	cs *connState
}

func (b *body) finish(err error, closed bool) {
	r := b.r
	r.mu.Lock()
	defer r.mu.Unlock()
	if b.cs.finished {
		return
	}
	b.cs.finished = true
	switch {
	case err == io.EOF:
		b.cs.rec.Ended = "server-closed"
	case err != nil:
		b.cs.rec.Ended, b.cs.rec.Error = r.classify(err)
	case closed:
		if r.timedOut() {
			b.cs.rec.Ended = "harness-timeout"
		} else {
			b.cs.rec.Ended = "client-closed"
		}
	}
}

func (b *body) Read(p []byte) (int, error) {
	n, err := b.rc.Read(p)
	if err != nil {
		b.finish(err, false)
	}
	return n, err
}

func (b *body) Close() error {
	b.finish(nil, true)
	return b.rc.Close()
}

// newTransport builds an HTTP/1.1-only transport from scratch. It must NOT be cloned from http.DefaultTransport:
// Clone first runs the original's h2 setup, so the copy's TLS config still offers "h2" in ALPN while its (empty)
// TLSNextProto map has no h2 handler, and the server answers in HTTP/2 to a client that then speaks HTTP/1.x
// ("malformed HTTP response" with a SETTINGS frame in it). Here the ALPN list is exactly http/1.1.
func newTransport() *http.Transport {
	return &http.Transport{
		Proxy:                 nil, // an ambient *_PROXY would change what the library talks to
		DialContext:           (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2:     false,
		TLSClientConfig:       &tls.Config{NextProtos: []string{"http/1.1"}},
		TLSNextProto:          map[string]func(string, *tls.Conn) http.RoundTripper{}, // non-nil and empty: HTTP/1.1 only
		MaxIdleConns:          10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
}

// ---------- the two clients ----------

type driver func(r *run)

// go-sse: class eventsource (see the header). Callbacks, OnRetry and Connect all run on this goroutine.
func runGoSSE(r *run) {
	var firstWait time.Duration
	var haveWait bool
	cl := &sse.Client{
		HTTPClient: &http.Client{Transport: &counting{r: r, rt: newTransport()}},
		Backoff:    sse.Backoff{Jitter: 1e-9}, // see header: the OnRetry delay is then the adopted retry, unjittered
		OnRetry: func(err error, wait time.Duration) {
			if r.stopped.Load() {
				return
			}
			r.addErr(err) // the error that caused the retry: the library's report of the connection ending
			if !haveWait {
				firstWait, haveWait = wait, true
			}
			if r.flavor != "resume" {
				r.stopReason = "reconnecting"
				r.stop()
			} else if r.connCount() >= maxConns {
				r.stopReason = "closed-by-harness"
				r.stop()
			}
		},
	}
	req, err := http.NewRequestWithContext(r.ctx, http.MethodGet, r.url, nil)
	if err != nil {
		r.addErr(err)
		r.setEnd("error")
		return
	}
	conn := cl.NewConnection(req)
	conn.SubscribeToAll(func(e sse.Event) {
		var id *string
		if e.LastEventID != "" {
			id = ptr(e.LastEventID)
		}
		r.addEvent(e.Type, id, e.Data)
		if id != nil {
			r.mu.Lock()
			r.lastID = id // Connection.lastEventID is private; the id carried by the last delivered event is its value
			r.mu.Unlock()
		}
	})
	cerr := conn.Connect()
	if haveWait && firstWait != 500*time.Millisecond { // 500 ms is the library's own initial interval: no retry was adopted
		r.mu.Lock()
		r.retry = ptr(int((firstWait + 500*time.Microsecond) / time.Millisecond))
		r.mu.Unlock()
	}
	switch {
	case r.timedOut():
		r.setEnd("harness-timeout")
	case r.stopReason != "":
		r.setEnd(r.stopReason)
	case cerr == nil:
		// Connect "never returns" without an error by its documentation, yet it does when the stream's last chunk is
		// a bare comment line (the parse loop ends without io.EOF and doConnect's errors.Is(nil, nil) is true): the
		// library stopped by itself, no error, no reconnection. That is a normal end from the caller's side.
		r.setEnd("clean")
	case !errors.Is(cerr, context.Canceled):
		r.addErr(cerr) // Connect returned by itself: a permanent error (validator) or retries exhausted
		if lc, ok := r.lastConn(); ok && lc.Status == http.StatusNoContent && r.connCount() > 1 {
			r.setEnd("stopped")
		} else {
			r.setEnd("error")
		}
	default:
		r.setEnd("error") // cancelled by the harness before any response (the retry logic in main owns this case)
	}
}

// r3labs/sse/v2: class one-shot (see the header). Event fields are []byte; the handler runs on the Subscribe goroutine.
func runR3labs(r *run) {
	cl := rsse.NewClient(r.url)
	cl.Connection = &http.Client{Transport: &counting{r: r, rt: newTransport()}}
	cl.ReconnectStrategy = &backoff.StopBackOff{} // the default would retry forever after an error and ignores the context
	serr := cl.SubscribeRawWithContext(r.ctx, func(m *rsse.Event) {
		var id *string
		if len(m.ID) > 0 {
			id = ptr(string(m.ID))
		}
		r.addEvent(string(m.Event), id, string(m.Data))
	})
	if v, ok := cl.LastEventID.Load().([]byte); ok && len(v) > 0 {
		r.mu.Lock()
		r.lastID = ptr(string(v))
		r.mu.Unlock()
	}
	switch {
	case r.timedOut():
		r.setEnd("harness-timeout")
	case r.stopped.Load():
		r.setEnd("error") // the harness stopped it before a response (the retry logic below owns this case)
	case serr != nil:
		r.addErr(serr)
		r.setEnd("error")
	default:
		r.setEnd("clean")
	}
}

// ---------- executing a row, with the watchdog ----------

func (r *run) execute(d driver) (abandoned bool) {
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer func() {
			if p := recover(); p != nil {
				r.addErr(fmt.Errorf("the library panicked: %v", p))
				r.setEnd("error")
			}
		}()
		d(r)
	}()
	select {
	case <-done:
		return false
	case <-time.After(rowCap + watchdogGrace):
		r.stop()
		r.mu.Lock()
		r.end = "harness-timeout"
		r.mu.Unlock()
		return true
	}
}

// build copies the row's state under the lock and seals it; a goroutine that outlives an abandoned row cannot change it.
func (r *run) build(cm clientMeta, attempt int, probed time.Time, wall time.Duration) (row, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sealed = true
	out := row{Family: "sse", ID: "sse." + r.flavor + "." + cm.ID, CorpusID: "sse." + r.flavor, URL: r.url, Method: "GET", Flavor: r.flavor,
		Probed: probed.UTC().Format("2006-01-02T15:04:05Z"), Client: cm, Attempts: attempt, Connections: []connRec{}, Events: []eventRec{}, Errors: []errRec{},
		RetryMsAdopted: r.retry, LastEventIDFin: r.lastID, WallMs: wall.Milliseconds()}
	for _, c := range r.conns {
		rec := c.rec
		if rec.Ended == "" { // never saw an EOF or an error and the library never closed it: the harness did
			if r.timedOut() {
				rec.Ended = "harness-timeout"
			} else {
				rec.Ended = "client-closed"
			}
		}
		out.Connections = append(out.Connections, rec)
	}
	out.Events = append(out.Events, r.events...)
	out.EventsDelivered = len(r.events)
	out.Errors = append(out.Errors, r.errs...)
	out.End = r.end
	out.BadhttpVersion = ""
	if len(out.Connections) > 0 {
		out.BadhttpVersion = out.Connections[0].XBadhttpVersion
	}
	for p := range r.protos {
		if p != "HTTP/1.1" {
			out.Client.ConnectionsCountedBy += "; OBSERVED protocol " + p + ", which could not be forced to HTTP/1.1"
		}
	}
	return out, len(out.Connections) > 0 && out.Connections[0].XBadhttpVersion != ""
}

// ---------- versions ----------

func moduleVersion(path string) string {
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, d := range bi.Deps {
			if d.Path == path {
				if d.Replace != nil {
					return d.Replace.Version
				}
				return d.Version
			}
		}
	}
	// `go run file.go` embeds no dependency list: read the module the harness is run from (its go.mod)
	if b, err := os.ReadFile("go.mod"); err == nil {
		re := regexp.MustCompile(`(?m)^\s*(?:require\s+)?` + regexp.QuoteMeta(path) + `\s+(v[^\s]+)`)
		if m := re.FindSubmatch(b); m != nil {
			return string(m[1])
		}
	}
	return "unknown"
}

// ---------- main ----------

func main() {
	base := "https://badhttp.dev"
	if len(os.Args) > 1 {
		base = strings.TrimRight(os.Args[1], "/")
	}
	flavors := allFlavors
	if only := os.Getenv("SSE_FLAVORS"); only != "" {
		flavors = strings.Fields(strings.ReplaceAll(only, ",", " "))
	}
	onlyClients := map[string]bool{}
	for _, c := range strings.Fields(strings.ReplaceAll(os.Getenv("SSE_CLIENTS"), ",", " ")) {
		onlyClients[c] = true
	}
	platform := runtime.Version() + " " + runtime.GOOS + "/" + runtime.GOARCH
	const countedBy = "a custom http.RoundTripper wrapping an http.Transport and injected into the library's http.Client; one RoundTrip is one connection, " +
		"and the response body is wrapped to record how it ended. The Transport is forced to HTTP/1.1 (TLSNextProto set to an empty map) and the protocol of every response is checked"
	type client struct {
		meta clientMeta
		run  driver
	}
	clients := []client{
		{clientMeta{ID: "go-sse", Name: "go-sse", Role: "client", Class: "eventsource", Version: moduleVersion("github.com/tmaxmax/go-sse"),
			Library:  "go-sse (tmaxmax/go-sse), Connection.Connect: reconnects by itself after the stream ends, adopts the server's retry; default retry behavior, Backoff.Jitter 1e-9 so OnRetry reports the adopted retry unjittered",
			Platform: platform,
			Invocation: "Go program run with go run from a module directory; sse.Client{HTTPClient: http.Client{Transport: counting RoundTripper}, Backoff.Jitter 1e-9, OnRetry}.NewConnection(GET request carrying a 30 s context).Connect(), " +
				"SubscribeToAll collecting events; stopped from OnRetry after the first connection on every flavor but resume, where it reconnects until it stops by itself or reaches 6 connections",
			ConnectionsCountedBy: countedBy}, runGoSSE},
		{clientMeta{ID: "r3labs-sse", Name: "r3labs/sse", Role: "client", Class: "one-shot", Version: moduleVersion("github.com/r3labs/sse/v2"),
			Library:  "r3labs/sse v2, Client.SubscribeRawWithContext: one call consumes one response and returns after a clean end (no reconnection after a close); configured with ReconnectStrategy = StopBackOff because its default ExponentialBackOff retries forever after any error and ignores the context",
			Platform: platform,
			Invocation: "Go program run with go run from a module directory; sse.NewClient(url) with Connection = http.Client{Transport: counting RoundTripper} and ReconnectStrategy = backoff.StopBackOff, " +
				"SubscribeRawWithContext(30 s context, handler) collecting events",
			ConnectionsCountedBy: countedBy}, runR3labs},
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	failed := 0
	first := true
	for _, c := range clients {
		if len(onlyClients) > 0 && !onlyClients[c.meta.ID] {
			continue
		}
		if !first {
			time.Sleep(3 * time.Second) // between clients
		}
		first = false
		for fi, f := range flavors {
			if fi > 0 {
				time.Sleep(1 * time.Second) // between rows
			}
			for attempt := 1; ; attempt++ {
				r := newRun(base, f)
				probed := time.Now()
				abandoned := r.execute(c.run)
				wall := time.Since(probed)
				timedOut := abandoned || r.timedOut()
				out, versioned := r.build(c.meta, attempt, probed, wall)
				r.cancel()
				if !versioned && !timedOut && attempt < 3 {
					st := 0
					if len(out.Connections) > 0 {
						st = out.Connections[0].Status
					}
					fmt.Fprintf(os.Stderr, "%s %s: no x-badhttp-version (status %d); retrying after 12 s\n", c.meta.ID, f, st)
					time.Sleep(12 * time.Second)
					continue
				}
				if !versioned {
					// never an observation: keep the connections as evidence, drop what was parsed from a response that is not this server's
					st := 0
					if len(out.Connections) > 0 {
						st = out.Connections[0].Status
					}
					out.Events, out.EventsDelivered = []eventRec{}, 0
					out.RetryMsAdopted, out.LastEventIDFin = nil, nil
					if !timedOut {
						out.End = "error"
					}
					out.Errors = append(out.Errors, errRec{Message: fmt.Sprintf("no x-badhttp-version on the first response after %d attempts (last status %d): not an observation", attempt, st)})
				}
				line, err := json.Marshal(out)
				if err == nil {
					err = hygiene(line)
				}
				if err != nil {
					failed++
					fmt.Fprintf(os.Stderr, "%s %s: row not emitted (%v) FAILED\n", c.meta.ID, f, err)
					break
				}
				if err := enc.Encode(out); err != nil {
					fmt.Fprintf(os.Stderr, "%s %s: cannot write row: %v\n", c.meta.ID, f, err)
					os.Exit(1)
				}
				if !versioned {
					failed++
					fmt.Fprintf(os.Stderr, "%s %s: FAILED after %d attempts (no x-badhttp-version)\n", c.meta.ID, f, attempt)
				} else {
					note := ""
					if abandoned {
						note = " (library abandoned by the watchdog)"
					}
					fmt.Fprintf(os.Stderr, "%s %s: %d events, end %s, %d connection(s), %d ms%s ok\n", c.meta.ID, f, out.EventsDelivered, out.End, len(out.Connections), out.WallMs, note)
				}
				break
			}
		}
	}
	if failed > 0 {
		os.Exit(1)
	}
}
