// Go net/http witness for /cookies. One JSON line per flavor on stdout; progress on stderr.
// Per flavor, with a FRESH net/http/cookiejar.Jar (PublicSuffixList: golang.org/x/net/publicsuffix.List):
//  1. GET /cookies/{flavor}  (net/http follows redirects by default; only on-redirect redirects)
//  2. GET /cookies/echo      what the jar sent back
//  3. GET /cookies/delete    the cleanup
//  4. GET /cookies/echo      what survived the cleanup
//
// 0.2 s between requests. A counting RoundTripper records every request the client sent during step 1 (redirects
// included) with its status and len(resp.Header.Values("Set-Cookie")). The jar cannot be enumerated (Jar.Cookies(u)
// returns only what is sendable to one URL), so jar_enumerable is false and jar_entries null. A response without
// x-badhttp-version is the edge's 429: the whole flavor is retried after a pause (attempts <= 3).
//
// golang.org/x/net is not in the standard library, so run from a throwaway module that has it:
//
//	mkdir -p GOMOD && cd GOMOD && go mod init cookieswitness && go get golang.org/x/net/publicsuffix
//	cd GOMOD && go run /ABSOLUTE/PATH/TO/scripts/cookies-witness/go-nethttp.go [base]
//
// COOKIE_FLAVORS="ok public-suffix" limits a dry run; a published capture always runs the full list.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"os"
	"regexp"
	"runtime"
	"strings"
	"time"

	"golang.org/x/net/publicsuffix"
)

var order = []string{"ok", "folded", "many", "duplicate", "on-redirect", "conflicting-expiry", "bad-expires", "far-future", "wrong-domain", "public-suffix", "domain", "path-prefix", "name-prefixes", "quoted", "utf8", "nameless", "huge"}

const invocation = "go run scripts/cookies-witness/go-nethttp.go, from a throwaway module (go mod init + go get golang.org/x/net/publicsuffix); http.Client{Jar: cookiejar.New(&cookiejar.Options{PublicSuffixList: publicsuffix.List}), Transport: counting RoundTripper, Timeout: 30s, CheckRedirect: stops at 6}"

const jarDesc = "net/http/cookiejar.Jar created with cookiejar.Options{PublicSuffixList: golang.org/x/net/publicsuffix.List}, a fresh jar per flavor, attached as http.Client.Jar"

type hop struct {
	Status         int `json:"status"`
	SetCookieCount int `json:"set_cookie_count"`
}

// One RoundTrip per request the client sends (the initial request and each followed redirect).
type counting struct {
	hops []hop
	rt   http.RoundTripper
}

func (c *counting) RoundTrip(r *http.Request) (*http.Response, error) {
	resp, err := c.rt.RoundTrip(r)
	if resp != nil {
		c.hops = append(c.hops, hop{resp.StatusCode, len(resp.Header.Values("Set-Cookie"))})
	}
	return resp, err
}

type echoCookie struct {
	Name       string  `json:"name"`
	ValueBytes int     `json:"value_bytes"`
	Value      *string `json:"value"`
}
type echoOut struct {
	Status            int          `json:"status"`
	CookieHeaderBytes int          `json:"cookie_header_bytes"`
	Cookies           []echoCookie `json:"cookies"`
	CookieHeaderB64   *string      `json:"cookie_header_base64"`
}
type afterOut struct {
	Status int      `json:"status"`
	Names  []string `json:"names"`
}
type rejection struct {
	Message string `json:"message"`
}
type row struct {
	Client         string      `json:"client"`
	ClientVersion  string      `json:"client_version"`
	Platform       string      `json:"platform"`
	Invocation     string      `json:"invocation"`
	Flavor         string      `json:"flavor"`
	URL            string      `json:"url"`
	JarKind        string      `json:"jar_kind"`
	Jar            string      `json:"jar"`
	Attempts       int         `json:"attempts"`
	Hops           []hop       `json:"hops"`
	SetterStatus   *int        `json:"setter_status"`
	SetterSet      any         `json:"setter_set"`
	Echo           *echoOut    `json:"echo"`
	AfterDelete    *afterOut   `json:"after_delete"`
	JarEnumerable  bool        `json:"jar_enumerable"`
	JarEntries     any         `json:"jar_entries"`
	JarRejections  []rejection `json:"jar_rejections"`
	VersionHeader  *string     `json:"version_header"`
	ClientError    *string     `json:"client_error"`
	ErrorKind      *string     `json:"error_kind"`
	LastStatusSeen *int        `json:"last_status_seen"`
}

type step struct {
	status int
	body   []byte
	vh     string
	err    error
}

func do(c *http.Client, u string) step {
	resp, err := c.Get(u)
	if err != nil {
		return step{err: err}
	}
	b, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		// a timeout or truncation while reading the body is a transport failure, not an edge page
		return step{err: err}
	}
	return step{status: resp.StatusCode, body: b, vh: resp.Header.Get("X-Badhttp-Version")}
}

var addrRe = regexp.MustCompile(`(\b[0-9]{1,3}(\.[0-9]{1,3}){3}(:[0-9]+)?)|(\[[0-9a-fA-F:]+\](:[0-9]+)?)`)

// Error text can carry the resolver's or the local address; keep the kind of failure, not the machine's addresses.
func scrub(s string) string { return addrRe.ReplaceAllString(s, "<addr>") }

func main() {
	b := "https://badhttp.dev"
	if len(os.Args) > 1 {
		b = os.Args[1]
	}
	if only := os.Getenv("COOKIE_FLAVORS"); only != "" {
		order = strings.Fields(strings.ReplaceAll(only, ",", " "))
	}
	enc := json.NewEncoder(os.Stdout)
	base := row{Client: "go-nethttp", ClientVersion: runtime.Version(), Platform: runtime.GOOS + "/" + runtime.GOARCH, Invocation: invocation, JarKind: "own-jar", Jar: jarDesc, JarEnumerable: false, JarEntries: nil, JarRejections: []rejection{}}
	for _, f := range order {
		u := b + "/cookies/" + f
		urls := []string{u, b + "/cookies/echo", b + "/cookies/delete", b + "/cookies/echo"}
		for attempt := 1; attempt <= 3; attempt++ {
			out := base
			out.Flavor, out.URL, out.Attempts, out.Hops = f, u, attempt, []hop{}
			jar, err := cookiejar.New(&cookiejar.Options{PublicSuffixList: publicsuffix.List})
			if err != nil {
				panic(err)
			}
			t := http.DefaultTransport.(*http.Transport).Clone()
			t.Proxy = nil // an ambient *_PROXY would change what the jar-bearing client talks to
			ct := &counting{rt: t}
			client := &http.Client{Transport: ct, Jar: jar, Timeout: 30 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 6 {
					return fmt.Errorf("too many redirects")
				}
				return nil
			}}
			var res [4]step
			var hops []hop
			var lastSeen *int
			failed := ""
			var ferr error
			for i, su := range urls {
				res[i] = do(client, su)
				if i == 0 {
					hops = append([]hop{}, ct.hops...)
				}
				if res[i].err != nil {
					failed, ferr = "error", res[i].err
					break
				}
				st := res[i].status
				lastSeen = &st
				if res[i].vh == "" || !json.Valid(res[i].body) {
					failed = "edge"
					break
				}
				if i < 3 {
					time.Sleep(200 * time.Millisecond)
				}
			}
			out.Hops, out.LastStatusSeen = hops, lastSeen
			if failed != "" {
				if attempt < 3 {
					fmt.Fprintln(os.Stderr, "go", f, ": no badhttp response (edge?), retrying")
					time.Sleep(12 * time.Second)
					continue
				}
				if failed == "error" {
					msg := scrub(ferr.Error())
					kind := "raised"
					var ne net.Error
					if errors.As(ferr, &ne) {
						kind = "transport"
					}
					out.ClientError, out.ErrorKind = &msg, &kind
				} else {
					ls := 0
					if lastSeen != nil {
						ls = *lastSeen
					}
					msg := fmt.Sprintf("not a badhttp response after 3 attempts (last status %d)", ls)
					out.ClientError = &msg
				}
				enc.Encode(out)
				fmt.Fprintln(os.Stderr, "go", f, "FAILED after 3 attempts")
				break
			}
			// step 1: the setter's own body, unless the client followed a redirect to the echo body
			s1 := res[0].status
			out.SetterStatus = &s1
			if f != "on-redirect" {
				var sb struct {
					Set json.RawMessage `json:"set"`
				}
				if json.Unmarshal(res[0].body, &sb) == nil && len(sb.Set) > 0 && string(sb.Set) != "null" {
					out.SetterSet = sb.Set
				}
			}
			var eb struct {
				CookieHeader *string    `json:"cookie_header"`
				Base64       *string    `json:"cookie_header_base64"`
				Cookies      [][]string `json:"cookies"`
			}
			json.Unmarshal(res[1].body, &eb)
			e := &echoOut{Status: res[1].status, Cookies: []echoCookie{}}
			if eb.CookieHeader != nil {
				e.CookieHeaderBytes = len(*eb.CookieHeader)
				if e.CookieHeaderBytes <= 256 {
					e.CookieHeaderB64 = eb.Base64
				}
			}
			for _, p := range eb.Cookies {
				if len(p) < 2 {
					continue
				}
				c := echoCookie{Name: p[0], ValueBytes: len(p[1])}
				if len(p[1]) <= 48 {
					v := p[1]
					c.Value = &v
				}
				e.Cookies = append(e.Cookies, c)
			}
			out.Echo = e
			var ab struct {
				Cookies [][]string `json:"cookies"`
			}
			json.Unmarshal(res[3].body, &ab)
			a := &afterOut{Status: res[3].status, Names: []string{}}
			for _, p := range ab.Cookies {
				if len(p) >= 1 {
					a.Names = append(a.Names, p[0])
				}
			}
			out.AfterDelete = a
			vh := res[3].vh
			out.VersionHeader = &vh
			enc.Encode(out)
			fmt.Fprintln(os.Stderr, "go", f, "ok")
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
}
