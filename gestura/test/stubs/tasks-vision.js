// Minimal stand-in for @mediapipe/tasks-vision.
//
// hands.js is the only module with a bare CDN import, which meant it had zero
// test coverage — and a scope bug inside it shipped undetected. Materialising
// this stub under node_modules lets Node resolve the specifier, so hands.js can
// be exercised headlessly like every other module.
export class FilesetResolver {
  static async forVisionTasks(path) {
    return { path, wasmLoaderPath: path };
  }
}

/** Records how it was constructed so tests can assert the delegate choice. */
export const created = [];

export class HandLandmarker {
  constructor(options) {
    this.options = options;
    this.delegate = options?.baseOptions?.delegate;
    this.closed = false;
    // Set by tests to control what detection returns or throws.
    this.onDetect = null;
    this.detectCalls = 0;
    created.push(this);
  }

  static async createFromOptions(_fileset, options) {
    return new HandLandmarker(options);
  }

  detectForVideo(_video, timestamp) {
    this.detectCalls++;
    if (this.onDetect) return this.onDetect(_video, timestamp);
    return { landmarks: [], worldLandmarks: [], handedness: [] };
  }

  close() {
    this.closed = true;
  }
}

export function reset() {
  created.length = 0;
}