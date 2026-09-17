// Witness: Go net/http with the default transport (it adds Accept-Encoding: gzip itself and transparently
// decodes gzip only when it added the header; response.Uncompressed says whether it did).
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"time"
)

func main() {
	base := "https://badhttp.dev"
	if len(os.Args) > 1 {
		base = os.Args[1]
	}
	flavors := []string{"ok", "br", "zstd", "deflate", "not-compressed", "undeclared", "truncated", "corrupt", "bad-crc", "trailing-garbage", "multi-member", "double", "double-hidden", "deflate-raw", "unknown-coding", "uppercase", "x-gzip", "empty", "wrong-length", "gzip-file", "bomb"}
	fmt.Printf("# %s net/http default transport\n", runtime.Version())
	client := &http.Client{Timeout: 60 * time.Second}
	for _, f := range flavors {
		resp, err := client.Get(base + "/compress/" + f)
		if err != nil {
			fmt.Printf("%s | get-error: %v\n", f, err)
			continue
		}
		body, rerr := io.ReadAll(resp.Body)
		resp.Body.Close()
		want := resp.Header.Get("X-Badhttp-Plain-Sha256")
		wantLen := resp.Header.Get("X-Badhttp-Plain-Bytes")
		sum := sha256.Sum256(body)
		got := hex.EncodeToString(sum[:])
		verdict := "LEN-?"
		if want != "" {
			if got == want {
				verdict = "SHA-OK"
			} else {
				first := ""
				if len(body) >= 2 {
					first = hex.EncodeToString(body[:2])
				}
				verdict = "sha-DIFF(first=" + first + ")"
			}
		} else if fmt.Sprint(len(body)) == wantLen {
			verdict = "LEN-OK"
		} else {
			verdict = "len-DIFF"
		}
		errs := "no-error"
		if rerr != nil {
			errs = "read-error: " + rerr.Error()
		}
		fmt.Printf("%s | %d | ce=[%s] uncompressed=%v | bytes=%d/%s | %s | %s\n", f, resp.StatusCode, resp.Header.Get("Content-Encoding"), resp.Uncompressed, len(body), wantLen, verdict, errs)
		time.Sleep(300 * time.Millisecond)
	}
}
