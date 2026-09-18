// Go net/http witness for /auth. One JSON line per flavor on stdout; progress on stderr.
// net/http has no challenge handling at all: the only credential mechanism is Request.SetBasicAuth (Basic,
// sent on the first request) or a header the caller sets. So Basic-shaped flavors get SetBasicAuth with the
// documented fake credentials, bearer gets a hand-set Authorization header, and the Digest flavors are sent
// with no credentials — the row records that the client has no Digest mechanism, which is the observation.
// A counting RoundTripper records every request the client sent, redirects and all.
//
//	go run scripts/auth-witness/go-nethttp.go [base]
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync/atomic"
	"time"
)

var order = []string{"basic", "bearer", "digest", "digest-sha256", "none", "bare-scheme", "unknown-scheme", "token68", "multi", "case", "quoted", "utf8", "always-401", "accept-any", "forbidden", "stale", "proxy", "redirect"}

type hop struct {
	Status             *int `json:"status"`
	Authorization      bool `json:"authorization"`
	ProxyAuthorization bool `json:"proxy_authorization"`
}

// One RoundTrip per request the client sends (the initial request and each followed redirect; net/http never
// re-sends for auth). Records header PRESENCE only, never a value.
type counting struct {
	n    int64
	hops []hop
	rt   http.RoundTripper
}

func (c *counting) RoundTrip(r *http.Request) (*http.Response, error) {
	atomic.AddInt64(&c.n, 1)
	h := hop{Authorization: r.Header.Get("Authorization") != "", ProxyAuthorization: r.Header.Get("Proxy-Authorization") != ""}
	resp, err := c.rt.RoundTrip(r)
	if resp != nil {
		st := resp.StatusCode
		h.Status = &st
	}
	c.hops = append(c.hops, h)
	return resp, err
}

func main() {
	b := "https://badhttp.dev"
	if len(os.Args) > 1 {
		b = os.Args[1]
	}
	if only := os.Getenv("AUTH_FLAVORS"); only != "" { // a dry run; a published capture always runs the full list
		order = strings.Fields(strings.ReplaceAll(only, ",", " "))
	}
	enc := json.NewEncoder(os.Stdout)
	for _, f := range order {
		u := b + "/auth/" + f
		var kind, mech string
		switch f {
		case "digest", "digest-sha256", "stale":
			kind, mech = "no-mechanism", "net/http has no Digest mechanism (no challenge handling of any kind); the request was sent with no credentials"
		case "multi", "bare-scheme", "unknown-scheme", "token68", "case", "quoted":
			kind, mech = "basic-auth", "Request.SetBasicAuth (the documented credentials): net/http reads no challenge, so the challenge this flavor sends was never observed by the client"
		case "bearer":
			kind, mech = "bearer-header", "a hand-set Authorization: Bearer header (the documented test token): net/http has no Bearer option"
		case "utf8":
			kind, mech = "basic-auth", "Request.SetBasicAuth with the documented utf8 credentials: net/http base64-encodes the string's UTF-8 bytes"
		case "proxy":
			kind, mech = "basic-auth", "Request.SetBasicAuth (the documented credentials, as ORIGIN credentials): no proxy exists in the harness and no proxy credentials were configured; this flavor reads only Proxy-Authorization"
		default:
			kind, mech = "basic-auth", "Request.SetBasicAuth (the documented credentials): net/http's own Basic option"
		}
		for attempt := 1; attempt <= 3; attempt++ {
			out := map[string]any{"client": "go-nethttp", "client_version": runtime.Version(), "platform": runtime.GOOS + "/" + runtime.GOARCH, "invocation": "http.Client{Transport: counting RoundTripper, Timeout: 30s, CheckRedirect: stops at 6}", "flavor": f, "url": u, "mechanism_kind": kind, "mechanism": mech, "attempts": attempt}
			t := http.DefaultTransport.(*http.Transport).Clone()
			t.Proxy = nil // never let an ambient *_PROXY add Proxy-Authorization anywhere
			ct := &counting{rt: t}
			hops := 0
			client := &http.Client{Transport: ct, Timeout: 30 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
				hops = len(via)
				if len(via) >= 6 {
					return fmt.Errorf("too many redirects")
				}
				return nil
			}}
			req, _ := http.NewRequest("GET", u, nil)
			switch kind {
			case "basic-auth":
				if f == "utf8" {
					req.SetBasicAuth("agent", "sésame")
				} else {
					req.SetBasicAuth("agent", "correct")
				}
			case "bearer-header":
				req.Header.Set("Authorization", "Bearer badhttp-token-ok")
			}
			resp, err := client.Do(req)
			out["requests_made"] = atomic.LoadInt64(&ct.n)
			if ct.hops == nil {
				out["hops"] = []hop{}
			} else {
				out["hops"] = ct.hops
			}
			if err != nil {
				out["client_error"] = err.Error()
				out["final_status"], out["redirects_followed"], out["final_url"], out["challenge_seen"], out["oracle"], out["version_header"] = nil, hops, nil, nil, nil, nil
				if attempt == 3 {
					enc.Encode(out)
					fmt.Fprintln(os.Stderr, "go", f, "FAILED:", err)
				} else {
					time.Sleep(12 * time.Second)
				}
				continue
			}
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			vh := resp.Header.Get("X-Badhttp-Version")
			var oracle map[string]any
			jsonOK := json.Unmarshal(body, &oracle) == nil
			if vh == "" || !jsonOK {
				if attempt == 3 {
					out["client_error"] = fmt.Sprintf("not an oracle response after 3 attempts (status %d)", resp.StatusCode)
					out["final_status"], out["redirects_followed"], out["final_url"], out["challenge_seen"], out["oracle"], out["version_header"] = resp.StatusCode, hops, resp.Request.URL.String(), nil, nil, nil
					enc.Encode(out)
					fmt.Fprintln(os.Stderr, "go", f, "FAILED: no oracle response")
				} else {
					fmt.Fprintln(os.Stderr, "go", f, ": no oracle response (edge?), retrying")
					time.Sleep(12 * time.Second)
				}
				continue
			}
			chal := resp.Header.Get("WWW-Authenticate")
			if chal == "" {
				chal = resp.Header.Get("Proxy-Authenticate")
			}
			out["final_status"] = resp.StatusCode
			out["redirects_followed"] = hops
			out["final_url"] = resp.Request.URL.String()
			if strings.TrimSpace(chal) == "" {
				out["challenge_seen"] = nil
			} else {
				out["challenge_seen"] = chal
			}
			delete(oracle, "warning")
			delete(oracle, "hint")
			delete(oracle, "credentials")
			out["oracle"] = oracle
			out["version_header"] = vh
			out["client_error"] = nil
			enc.Encode(out)
			fmt.Fprintln(os.Stderr, "go", f, "ok")
			break
		}
		time.Sleep(1200 * time.Millisecond)
	}
}
