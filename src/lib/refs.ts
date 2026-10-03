// A reference this repo does not resolve: any scheme, protocol-relative, an
// anchor, or a site-absolute path.
export const isExternal = (ref: string): boolean => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(ref);
