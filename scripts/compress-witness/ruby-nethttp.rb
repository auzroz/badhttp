# Witness: Ruby Net::HTTP with its defaults (it adds an Accept-Enc header for gz/deflate itself and decodes).
require 'net/http'
require 'digest'
require 'uri'
B = ARGV[0] || 'https://badhttp.dev'
FLAVORS = %w[ok br zstd deflate not-compressed undeclared truncated corrupt bad-crc trailing-garbage multi-member double double-hidden deflate-raw unknown-coding uppercase x-gzip empty wrong-length gzip-file bomb]
puts "# ruby #{RUBY_VERSION} Net::HTTP (decode_content=true by default)"
FLAVORS.each do |f|
  begin
    uri = URI("#{B}/compress/#{f}")
    res = Net::HTTP.get_response(uri)
    body = res.body || ''
    want = res['x-badhttp-plain-sha256']; want_len = res['x-badhttp-plain-bytes']
    v = if want then (Digest::SHA256.hexdigest(body) == want ? 'SHA-OK' : "sha-DIFF(first=#{body[0,2].unpack1('H*')})") else (body.bytesize.to_s == want_len ? 'LEN-OK' : 'len-DIFF') end
    puts "#{f} | #{res.code} | ce=[#{res['content-encoding']}] | bytes=#{body.bytesize}/#{want_len} | #{v} | no-error"
  rescue => e
    puts "#{f} | error: #{e.class}: #{e.message[0,100]}"
  end
  sleep 0.3
end
