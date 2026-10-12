// Command gotool drives two Go HTTP-cache transports for the /etag witness family, speaking the
// driver protocol (see ../README.md): HELLO, then FETCH <url> -> RESULT {json} per line, QUIT -> exit 0.
//
//	gotool gregjones-httpcache   github.com/gregjones/httpcache Transport over diskcache in the working directory
//	gotool bartventer-httpcache  github.com/bartventer/httpcache Transport over the fscache backend in the working directory
//
// Both wrap an http.Transport built from scratch (ForceAttemptHTTP2 false, empty TLSNextProto, proxy from the
// environment). Redirects are not followed. Exit 2: the driver itself could not run.
package main

import (
	"bufio"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"runtime/debug"
	"strings"

	bartventer "github.com/bartventer/httpcache"
	_ "github.com/bartventer/httpcache/store/fscache"
	gregjones "github.com/gregjones/httpcache"
	"github.com/gregjones/httpcache/diskcache"
)

var (
	reOrigin = regexp.MustCompile(`https?://(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?`)
	reHost   = regexp.MustCompile(`(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?`)
	rePath   = regexp.MustCompile(`(?:/Users|/Volumes|/private|/var|/tmp|/home)/[^\s'")\]]+`)
	rePortA  = regexp.MustCompile(`(<host>['")\]]*)[,: ]+\d{2,5}\b`)
	rePortB  = regexp.MustCompile(`(?i)\bports?\s*[=:]?\s*\d{2,5}\b`)
)

func scrub(s string) string {
	s = reOrigin.ReplaceAllString(s, "https://badhttp.dev")
	s = reHost.ReplaceAllString(s, "<host>")
	s = rePath.ReplaceAllString(s, "<path>")
	s = rePortA.ReplaceAllString(s, "$1")
	s = rePortB.ReplaceAllString(s, "port")
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 200 {
		s = string(r[:200])
	}
	return s
}

func die(msg string) {
	fmt.Fprintln(os.Stderr, "driver: "+scrub(msg))
	os.Exit(2)
}

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
	return "unknown"
}

func transport() *http.Transport {
	return &http.Transport{
		Proxy:             http.ProxyFromEnvironment,
		ForceAttemptHTTP2: false,
		TLSNextProto:      map[string]func(string, *tls.Conn) http.RoundTripper{},
	}
}

type hello struct {
	Library       string `json:"library"`
	Version       string `json:"version"`
	Runtime       string `json:"runtime"`
	HTTP          string `json:"http"`
	Configuration string `json:"configuration"`
}

type errInfo struct {
	Name    string `json:"name"`
	Message string `json:"message"`
}

type result struct {
	OK          bool              `json:"ok"`
	Status      *int              `json:"status"`
	Bytes       int               `json:"bytes"`
	SHA256      string            `json:"sha256"`
	Error       *errInfo          `json:"error"`
	LibrarySays map[string]string `json:"library_says"`
	Exit        any               `json:"exit"`
}

func emit(prefix string, v any) {
	var sb strings.Builder
	enc := json.NewEncoder(&sb)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
	fmt.Print(prefix + " " + sb.String())
}

func main() {
	// No proxy variables reach the transports: the family measures the cache, not an environment's proxy.
	for _, k := range []string{"http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY", "no_proxy", "NO_PROXY"} {
		os.Unsetenv(k)
	}
	os.Setenv("NO_PROXY", "*")
	if len(os.Args) != 2 {
		die("usage: gotool gregjones-httpcache|bartventer-httpcache")
	}
	cwd, err := os.Getwd()
	if err != nil {
		die("getwd: " + err.Error())
	}
	var rt http.RoundTripper
	var h hello
	h.Runtime = "go" + strings.TrimPrefix(runtime.Version(), "go")
	h.HTTP = "1.1"
	switch os.Args[1] {
	case "gregjones-httpcache":
		dir := filepath.Join(cwd, "gj-cache")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			die("mkdir: " + err.Error())
		}
		t := gregjones.NewTransport(diskcache.New(dir))
		t.Transport = transport()
		rt = t
		h.Library = "gregjones/httpcache"
		h.Version = moduleVersion("github.com/gregjones/httpcache")
		h.Configuration = "httpcache.NewTransport(diskcache.New(<directory in the working directory>)) over an http.Transport built from scratch (ForceAttemptHTTP2 false, empty TLSNextProto), MarkCachedResponses default (true), redirects not followed"
	case "bartventer-httpcache":
		dsn := "fscache://" + filepath.ToSlash(cwd) + "?appname=bv-cache"
		func() {
			defer func() {
				if r := recover(); r != nil {
					die(fmt.Sprint("open cache: ", r))
				}
			}()
			rt = bartventer.NewTransport(dsn, bartventer.WithUpstream(transport()))
		}()
		h.Library = "bartventer/httpcache"
		h.Version = moduleVersion("github.com/bartventer/httpcache")
		h.Configuration = "httpcache.NewTransport(\"fscache://<working directory>?appname=bv-cache\", WithUpstream(http.Transport built from scratch: ForceAttemptHTTP2 false, empty TLSNextProto)), other options default, redirects not followed"
	default:
		die("unknown client id " + os.Args[1])
	}
	client := &http.Client{
		Transport:     rt,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	emit("HELLO", h)

	empty := sha256.Sum256(nil)
	sc := bufio.NewScanner(os.Stdin)
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), "\r\n")
		if line == "QUIT" {
			break
		}
		if !strings.HasPrefix(line, "FETCH ") {
			continue
		}
		res := result{SHA256: hex.EncodeToString(empty[:])}
		resp, err := client.Get(strings.TrimSpace(line[6:]))
		if err != nil {
			res.Error = &errInfo{Name: fmt.Sprintf("%T", err), Message: scrub(err.Error())}
		} else {
			body, rerr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if rerr != nil {
				res.Error = &errInfo{Name: fmt.Sprintf("%T", rerr), Message: scrub(rerr.Error())}
			} else {
				sum := sha256.Sum256(body)
				code := resp.StatusCode
				res.OK, res.Status, res.Bytes, res.SHA256 = true, &code, len(body), hex.EncodeToString(sum[:])
				says := map[string]string{}
				for _, k := range []string{"X-From-Cache", "X-Httpcache-Status"} {
					if v := resp.Header.Get(k); v != "" {
						says[k] = v
					}
				}
				if len(says) > 0 {
					res.LibrarySays = says
				}
			}
		}
		emit("RESULT", res)
	}
	os.Exit(0)
}
