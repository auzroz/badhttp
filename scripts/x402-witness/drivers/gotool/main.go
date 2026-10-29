// Go x402 payment-client driver for the /402 witness family. Speaks the driver protocol (see ../README.md):
//
//	X402_WITNESS_PAYER_KEY=0x... gotool <client-id>
//
// client ids: x402-go. One process per cell; ONE wrapped GET per FETCH line; no redirects; no retry of our own; no spending limit set
// by us. The key is read from the environment, removed from it, and never printed.
package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"runtime"
	"runtime/debug"
	"strings"

	x402 "github.com/x402-foundation/x402/go"
	x402http "github.com/x402-foundation/x402/go/http"
	evm "github.com/x402-foundation/x402/go/mechanisms/evm/exact/client"
	evmsigners "github.com/x402-foundation/x402/go/signers/evm"
)

const network = "eip155:84532"

var (
	key      = os.Getenv("X402_WITNESS_PAYER_KEY")
	hex64    = regexp.MustCompile(`0x[0-9a-fA-F]{64,}`)
	loop     = regexp.MustCompile(`https?://(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?`)
	hostPort = regexp.MustCompile(`(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?`)
	paths    = regexp.MustCompile(`(?:/Users|/Volumes|/private|/var|/tmp|/home)/[^\s'")\]]+`)
	spaces   = regexp.MustCompile(`\s+`)
	says     = map[string]any{}
)

func scrub(s string) string {
	for _, k := range []string{key, strings.ToLower(key), strings.TrimPrefix(key, "0x")} {
		if k != "" {
			s = strings.ReplaceAll(s, k, "<key>")
		}
	}
	s = hex64.ReplaceAllString(s, "<hex>")
	s = loop.ReplaceAllString(s, "https://badhttp.dev")
	s = hostPort.ReplaceAllString(s, "<host>")
	s = paths.ReplaceAllString(s, "<path>")
	s = strings.TrimSpace(spaces.ReplaceAllString(s, " "))
	if len(s) > 300 {
		s = s[:300]
	}
	return s
}

func die(msg string) {
	fmt.Fprintln(os.Stderr, "driver: "+scrub(msg))
	os.Exit(2)
}

func main() {
	os.Unsetenv("X402_WITNESS_PAYER_KEY")
	for _, e := range os.Environ() {
		if i := strings.IndexByte(e, '='); i > 0 && regexp.MustCompile(`(?i)^(https?_proxy|all_proxy|no_proxy)$`).MatchString(e[:i]) {
			os.Unsetenv(e[:i])
		}
	}
	os.Setenv("NO_PROXY", "*")
	if len(os.Args) != 2 || os.Args[1] != "x402-go" {
		die("usage: gotool <x402-go>")
	}
	if !regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`).MatchString(key) {
		die("X402_WITNESS_PAYER_KEY is not a 0x-prefixed 64-hex key")
	}
	signer, err := evmsigners.NewClientSignerFromPrivateKey(key)
	if err != nil {
		die("signer: " + err.Error())
	}
	client := x402.Newx402Client().Register(network, evm.NewExactEvmScheme(signer, nil))
	client.OnAfterPaymentCreation(func(c x402.PaymentCreatedContext) error {
		says["payment_created"] = true
		if r := c.SelectedRequirements; r != nil {
			says["selected"] = map[string]any{"scheme": r.GetScheme(), "network": r.GetNetwork(), "amount": r.GetAmount(), "payTo": r.GetPayTo()}
		}
		return nil
	})
	client.OnPaymentCreationFailure(func(c x402.PaymentCreationFailureContext) (*x402.PaymentCreationFailureHookResult, error) {
		name, msg := "error", ""
		if c.Error != nil {
			name, msg = fmt.Sprintf("%T", c.Error), c.Error.Error()
		}
		says["creation_failed"] = map[string]any{"name": name, "message": scrub(msg)}
		return nil, nil
	})
	hc := x402http.Newx402HTTPClient(client)
	base := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	httpClient := x402http.WrapHTTPClientWithPayment(base, hc)

	version := "unknown"
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, d := range bi.Deps {
			if d.Path == "github.com/x402-foundation/x402/go" {
				version = d.Version
			}
		}
	}
	hello, _ := json.Marshal(map[string]any{
		"library": "x402 (go) net/http client", "version": version, "runtime": runtime.Version(), "http": "1.1", "generation": "v2",
		"configuration": "Base Sepolia (eip155:84532) registered for the v2 exact scheme; signer: a local private key; library defaults",
	})
	fmt.Println("HELLO " + string(hello))

	sc := bufio.NewScanner(os.Stdin)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), "\r\n")
		switch {
		case strings.HasPrefix(line, "FETCH "):
			fetch(httpClient, hc, strings.TrimSpace(line[6:]))
		case strings.TrimSpace(line) == "QUIT":
			os.Exit(0)
		}
	}
}

func fetch(httpClient *http.Client, hc interface {
	GetPaymentSettleResponse(map[string]string) (*x402.SettleResponse, error)
}, url string) {
	for k := range says {
		delete(says, k)
	}
	empty := sha256.Sum256(nil)
	res := map[string]any{"ok": false, "status": nil, "bytes": 0, "sha256": hex.EncodeToString(empty[:]), "error": nil, "library_says": nil, "exit": nil}
	resp, err := httpClient.Get(url)
	if err != nil {
		res["error"] = map[string]any{"name": fmt.Sprintf("%T", err), "message": scrub(err.Error())}
	} else {
		defer resp.Body.Close()
		body, rerr := io.ReadAll(resp.Body)
		if rerr != nil {
			res["error"] = map[string]any{"name": fmt.Sprintf("%T", rerr), "message": scrub(rerr.Error())}
		} else {
			sum := sha256.Sum256(body)
			res["ok"], res["status"], res["bytes"], res["sha256"] = true, resp.StatusCode, len(body), hex.EncodeToString(sum[:])
		}
		hdr := map[string]string{}
		for k, v := range resp.Header {
			if len(v) > 0 {
				hdr[k] = v[0]
			}
		}
		if hdr["Payment-Response"] != "" || hdr["X-Payment-Response"] != "" {
			if rec, e := hc.GetPaymentSettleResponse(hdr); e != nil {
				says["receipt_decode_error"] = fmt.Sprintf("%T", e)
			} else {
				says["receipt"] = map[string]any{"success": rec.Success, "transaction": rec.Transaction, "network": string(rec.Network), "payer": rec.Payer, "errorReason": scrub(rec.ErrorReason)}
			}
		}
	}
	if len(says) > 0 {
		if b, _ := json.Marshal(says); len(b) > 2048 {
			res["library_says"] = map[string]any{"truncated": true}
		} else {
			var v any
			json.Unmarshal(b, &v)
			res["library_says"] = v
		}
	}
	b, _ := json.Marshal(res)
	fmt.Println("RESULT " + string(b))
}
