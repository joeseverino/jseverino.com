// A path relative to the referring file, the only kind of reference the sync resolves: not a URL
// with a scheme, a protocol-relative or site-absolute path, or an anchor.
export const isRelativePath = (ref: string): boolean => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(ref);
