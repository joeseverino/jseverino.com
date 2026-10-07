// A reference this repo does not resolve: scheme, protocol-relative, anchor, or site-absolute.
export const isExternal = (ref: string): boolean => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(ref);
