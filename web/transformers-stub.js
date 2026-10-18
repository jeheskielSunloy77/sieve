// Stub for @huggingface/transformers — used for iOS app bundles, which run in
// a WKWebView with a native CoreML bridge for inference. Swapping in no-op
// stubs keeps those bundles small and eliminates unnecessary wasm assets.

const NOT_AVAILABLE = "@huggingface/transformers is not available in this build";

export async function pipeline() {
  throw new Error(NOT_AVAILABLE);
}

export const env = {
  allowLocalModels: false,
  allowRemoteModels: false,
  localModelPath: '',
  backends: {
    onnx: {
      wasm: {
        wasmPaths: '',
      },
    },
  },
};
