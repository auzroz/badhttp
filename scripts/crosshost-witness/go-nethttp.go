// Go net/http witness for /crosshost. One JSON line per flavor on stdout.
// Sends the family's PUBLISHED FAKE test values only. A fresh client and cookie jar per flavor; on the
// `jar` flavor the hand-set Cookie header is omitted so the jar, not the header, is what is measured.
// A final response without x-badhttp-version is Cloudflare's rate-limit page, not an observation.
//
//	go run scripts/crosshost-witness/go-nethttp.go [base]
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"runtime"
	"time"
)

const basic = "Basic YWdlbnQ6Y29ycmVjdA=="
const apikey = "badhttp-key-ok"
const cookie = "badhttp_witness=1"

var order = []string{"same-origin", "to-subdomain", "from-subdomain", "boomerang", "scheme-upgrade", "scheme-downgrade", "port-change", "relative-authority", "jar"}

func main() {
	b := "https://badhttp.dev"
	if len(os.Args) > 1 {
		b = os.Args[1]
	}
	r, err := http.Get(b + "/crosshost")
	if err != nil {
		panic(err)
	}
	var idx struct {
		Flavors map[string]struct {
			Url string `json:"url"`
		} `json:"flavors"`
	}
	json.NewDecoder(r.Body).Decode(&idx)
	r.Body.Close()
	enc := json.NewEncoder(os.Stdout)
	for _, f := range order {
		u := idx.Flavors[f].Url
		var sent map[string]any
		if f == "jar" {
			sent = map[string]any{"authorization": "Basic (documented test value)", "cookie": nil, "x_api_key": "documented test value", "jar": "enabled: net/http/cookiejar (empty)"}
		} else {
			sent = map[string]any{"authorization": "Basic (documented test value)", "cookie": cookie, "x_api_key": "documented test value", "jar": "enabled: net/http/cookiejar (empty)"}
		}
		for attempt := 1; attempt <= 3; attempt++ {
			out := map[string]any{"attempts": attempt, "client": "go-nethttp", "client_version": runtime.Version(), "platform": runtime.GOOS + "/" + runtime.GOARCH, "invocation": "http.Client{Jar: cookiejar, Timeout: 30s, CheckRedirect: counts hops, stops at 6}", "flavor": f, "start_url": u, "sent": sent}
			jar, _ := cookiejar.New(nil)
			hops := 0
			client := &http.Client{Jar: jar, Timeout: 30 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
				hops = len(via)
				if len(via) >= 6 {
					return errors.New("too many redirects")
				}
				return nil
			}}
			req, _ := http.NewRequest("GET", u, nil)
			req.Header.Set("Authorization", basic)
			req.Header.Set("X-Api-Key", apikey)
			if f != "jar" {
				req.Header.Set("Cookie", cookie)
			}
			resp, err := client.Do(req)
			if err != nil {
				out["client_error"] = err.Error()
				out["final_status"], out["hops_followed"], out["final_url"], out["landed_on"], out["received"], out["version_header"] = nil, hops, nil, nil, nil, nil
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
			json.Unmarshal(body, &oracle)
			if vh == "" || oracle["landed_on"] == nil {
				if attempt == 3 {
					out["client_error"] = fmt.Sprintf("not an oracle response after 3 attempts (status %d)", resp.StatusCode)
					out["final_status"], out["hops_followed"], out["final_url"], out["landed_on"], out["received"], out["version_header"] = resp.StatusCode, hops, resp.Request.URL.String(), nil, nil, nil
					enc.Encode(out)
					fmt.Fprintln(os.Stderr, "go", f, "FAILED: no oracle response")
				} else {
					fmt.Fprintln(os.Stderr, "go", f, ": no oracle response (edge?), retrying")
					time.Sleep(12 * time.Second)
				}
				continue
			}
			out["final_status"] = resp.StatusCode
			out["hops_followed"] = hops
			out["final_url"] = resp.Request.URL.String()
			for _, k := range []string{"landed_on", "port", "scheme", "transport_was_encrypted", "received"} {
				out[k] = oracle[k]
			}
			out["matches"] = oracle["matches_documented_test_credential"]
			out["version_header"] = vh
			out["client_error"] = nil
			enc.Encode(out)
			fmt.Fprintln(os.Stderr, "go", f, "ok")
			break
		}
		time.Sleep(1200 * time.Millisecond)
	}
}
