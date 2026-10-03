// The build stamps this value on the scripts and styles the site itself emits;
// the middleware swaps it for the per-request nonce. A tag without it is never
// nonced, so markup that reaches a page any other way cannot execute.
export const CSP_NONCE_PLACEHOLDER = '__CSP_NONCE__';
export const CSP_NONCE_ATTRIBUTE = `nonce="${CSP_NONCE_PLACEHOLDER}"`;
