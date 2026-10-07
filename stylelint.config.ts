export default {
  extends: ['stylelint-config-standard'],
  rules: {
    'at-rule-empty-line-before': null,
    'color-hex-length': null,
    'comment-empty-line-before': null,
    'custom-property-empty-line-before': null,
    'declaration-block-single-line-max-declarations': null,
    'declaration-empty-line-before': null,

    // Native nesting creates false ordering positives.
    'no-descending-specificity': null,

    // Logical longhands and the WebKit backdrop prefix are intentional.
    'declaration-block-no-redundant-longhand-properties': null,
    'property-no-vendor-prefix': null,

    'selector-class-pattern': null,
    'value-keyword-case': null,

    'no-duplicate-selectors': true,
    'block-no-empty': true,
  },
};
