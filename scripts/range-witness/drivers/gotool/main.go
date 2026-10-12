// Command gotool drives two Go download libraries through one resume, for the /range witness family.
//
//	gotool grab   URL OUTFILE   github.com/cavaliergopher/grab/v3 Client.Do
//	gotool getter URL OUTFILE   github.com/hashicorp/go-getter Client.Get (file mode, HttpGetter)
//	gotool versions             print both module versions
//
// Both libraries get an HTTP client built from scratch whose Transport speaks HTTP/1.1 only
// (ForceAttemptHTTP2 false, empty TLSNextProto) and honours the proxy environment, nothing else.
// Resume behaviour is each library's default: grab with NoResume false, go-getter with its
// HEAD-first Accept-Ranges check. Neither is retried.
//
// Exit 0: the library reported success. 1: it reported an error. 2: the driver could not run.
// The LAST stdout line is `RESULT {json}`.
package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"runtime"
	"runtime/debug"
	"strings"

	"github.com/cavaliergopher/grab/v3"
	"github.com/hashicorp/go-getter"
)

const (
	grabPath   = "github.com/cavaliergopher/grab/v3"
	getterPath = "github.com/hashicorp/go-getter"
)

type result struct {
	OK      bool    `json:"ok"`
	Kind    string  `json:"kind"`
	Name    *string `json:"name"`
	Message string  `json:"message"`
	Library string  `json:"library"`
	Version string  `json:"version"`
	Runtime string  `json:"runtime"`
	HTTP    string  `json:"http"`
}

var (
	reOrigin = regexp.MustCompile(`https?://(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?`)
	reHost   = regexp.MustCompile(`(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?`)
	rePath   = regexp.MustCompile(`(?:/Users|/Volumes|/private|/var|/tmp|/home)/[^\s'")\]]+`)
)

// scrub removes machine specifics (loopback origin, ports, absolute paths) and caps the length at 200.
func scrub(s string) string {
	s = reOrigin.ReplaceAllString(s, "https://badhttp.dev")
	s = reHost.ReplaceAllString(s, "<host>")
	s = rePath.ReplaceAllString(s, "<path>")
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 200 {
		s = string(r[:200])
	}
	return s
}

func finish(res result, code int) {
	res.Message = scrub(res.Message)
	res.Runtime = "go" + strings.TrimPrefix(runtime.Version(), "go")
	res.HTTP = "1.1"
	var sb strings.Builder
	enc := json.NewEncoder(&sb)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(res) // appends the newline
	fmt.Print("RESULT " + sb.String())
	os.Exit(code)
}

func failure(library, version string, err error, code int) {
	name := fmt.Sprintf("%T", err)
	finish(result{Kind: "raised", Name: &name, Message: err.Error(), Library: library, Version: version}, code)
}

func success(library, version string) {
	finish(result{OK: true, Kind: "return", Library: library, Version: version}, 0)
}

// moduleVersion reads the module's version from the build info; `go run` embeds no dependency
// list, so fall back to the go.mod in the working directory.
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
	if b, err := os.ReadFile("go.mod"); err == nil {
		re := regexp.MustCompile(`(?m)^\s*(?:require\s+)?` + regexp.QuoteMeta(path) + `\s+(v[^\s]+)`)
		if m := re.FindSubmatch(b); m != nil {
			return string(m[1])
		}
	}
	return "unknown"
}

// transport is built from scratch: HTTP/1.1 only, proxy from the environment, no other settings.
func transport() *http.Transport {
	return &http.Transport{
		Proxy:             http.ProxyFromEnvironment,
		ForceAttemptHTTP2: false,
		TLSNextProto:      map[string]func(string, *tls.Conn) http.RoundTripper{},
	}
}

func runGrab(url, dst string) {
	v := moduleVersion(grabPath)
	c := grab.NewClient()
	c.HTTPClient = &http.Client{Transport: transport()}
	req, err := grab.NewRequest(dst, url)
	if err != nil {
		name := fmt.Sprintf("%T", err)
		finish(result{Kind: "raised", Name: &name, Message: err.Error(), Library: "grab", Version: v}, 2)
	}
	req.NoResume = false
	resp := c.Do(req)
	<-resp.Done
	err = resp.Err()
	status := 0
	if resp.HTTPResponse != nil {
		status = resp.HTTPResponse.StatusCode
	}
	// human line: grab's own account of whether it resumed (didResume), its last status and size
	summary := fmt.Sprintf("didResume=%v canResume=%v status=%d size=%d bytesComplete=%d",
		resp.DidResume, resp.CanResume, status, resp.Size(), resp.BytesComplete())
	fmt.Println("GRAB " + summary)
	if err != nil {
		name := fmt.Sprintf("%T", err)
		finish(result{Kind: "raised", Name: &name, Message: err.Error() + " (" + summary + ")", Library: "grab", Version: v}, 1)
	}
	finish(result{OK: true, Kind: "return", Message: summary, Library: "grab", Version: v}, 0)
}

func runGetter(url, dst string) {
	v := moduleVersion(getterPath)
	g := &getter.HttpGetter{Client: &http.Client{Transport: transport()}}
	cl := &getter.Client{
		Src:     url,
		Dst:     dst,
		Mode:    getter.ClientModeFile,
		Getters: map[string]getter.Getter{"http": g, "https": g},
	}
	if err := cl.Get(); err != nil {
		failure("go-getter", v, err, 1)
	}
	success("go-getter", v)
}

func main() {
	args := os.Args[1:]
	switch {
	case len(args) == 1 && args[0] == "versions":
		fmt.Printf("grab %s\ngo-getter %s\n%s\n", moduleVersion(grabPath), moduleVersion(getterPath), runtime.Version())
	case len(args) == 3 && args[0] == "grab":
		runGrab(args[1], args[2])
	case len(args) == 3 && args[0] == "getter":
		runGetter(args[1], args[2])
	default:
		name := "DriverError"
		lib := "grab"
		if len(args) > 0 && args[0] == "getter" {
			lib = "go-getter"
		}
		finish(result{Kind: "raised", Name: &name, Message: "usage: gotool grab|getter URL OUTFILE | gotool versions", Library: lib, Version: "unknown"}, 2)
	}
}
