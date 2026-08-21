import assert from "node:assert/strict";
import test from "node:test";
import {
  fixedUpstreamUrl,
  fixedUpstreamWebSocketUrl,
  isClientWorkspacePath,
  isEmbeddedLocalServiceReferer,
  isPermittedLocalGatewayRequest,
  proxyResponseHeaders,
  rewriteLocalServiceLocation,
  sameLocalServiceEndpoint,
  webSocketCloseArguments
} from "../server/local-service-proxy.js";

test("fixed service proxy preserves the configured upstream authority", () => {
  assert.equal(
    fixedUpstreamUrl("http://127.0.0.1:8188", "/object_info?x=1").href,
    "http://127.0.0.1:8188/object_info?x=1"
  );
  assert.equal(
    fixedUpstreamUrl("http://127.0.0.1:8188/base", "//evil.example/prompt").href,
    "http://127.0.0.1:8188/base/prompt"
  );
});

test("websocket proxy uses the fixed service and preserves path/query", () => {
  assert.equal(
    fixedUpstreamWebSocketUrl("https://127.0.0.1:8188", "/ws?clientId=abc").href,
    "wss://127.0.0.1:8188/ws?clientId=abc"
  );
});

test("hop-by-hop response headers are not forwarded", () => {
  assert.deepEqual(proxyResponseHeaders({ "content-type": "text/plain", connection: "close", "content-length": "3" }), {
    "content-type": "text/plain"
  });
});

test("gateway requests require a loopback host and matching browser origin", () => {
  assert.equal(isPermittedLocalGatewayRequest({ host: "127.0.0.1:8789" }), true);
  assert.equal(isPermittedLocalGatewayRequest({ host: "localhost:8789", origin: "http://localhost:8789" }), true);
  assert.equal(isPermittedLocalGatewayRequest({ host: "127.0.0.1:8789", origin: "https://example.com" }), false);
  assert.equal(isPermittedLocalGatewayRequest({ host: "rebinding.example:8789", origin: "http://rebinding.example:8789" }), false);
  assert.equal(isEmbeddedLocalServiceReferer({ host: "127.0.0.1:8789", referer: "http://127.0.0.1:8789/integrations/comfyui/" }), true);
  assert.equal(isEmbeddedLocalServiceReferer({ host: "127.0.0.1:8789", referer: "http://127.0.0.1:8789/direct/comfyui" }), false);
});

test("the legacy media workspace reaches the SPA without exposing missing media files", () => {
  assert.equal(isClientWorkspacePath("/media"), true);
  assert.equal(isClientWorkspacePath("/media/project/assets/file.png"), false);
  assert.equal(isClientWorkspacePath("/api/health"), false);
});

test("Director and Premiere recognize equivalent loopback service endpoints", () => {
  assert.equal(sameLocalServiceEndpoint("http://127.0.0.1:8188/", "http://localhost:8188"), true);
  assert.equal(sameLocalServiceEndpoint("http://127.0.0.1:8188", "http://127.0.0.1:8190"), false);
});

test("same-service redirects stay behind the public gateway", () => {
  assert.equal(
    rewriteLocalServiceLocation("http://127.0.0.1:8188/user?x=1", "http://127.0.0.1:8188", "/integrations/comfyui"),
    "/integrations/comfyui/user?x=1"
  );
  assert.equal(rewriteLocalServiceLocation("https://example.com/escape", "http://127.0.0.1:8188", "/integrations/comfyui"), null);
});

test("abnormal websocket close codes are not echoed into another socket", () => {
  assert.deepEqual(webSocketCloseArguments(1000, "done"), [1000, "done"]);
  assert.deepEqual(webSocketCloseArguments(1006, "abnormal"), []);
});
