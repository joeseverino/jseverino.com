export default {
  extends: ['stylelint-config-standard'],
  rules: {
    // Preserve the file's deliberate grouping and compact one-line rules.
    'at-rule-empty-line-before': null,
    'color-hex-length': null,
    'comment-empty-line-before': null,
    'custom-property-empty-line-before': null,
    'declaration-block-single-line-max-declarations': null,
    'declaration-empty-line-before': null,

    // Native nesting creates false ordering positives across component blocks.
    'no-descending-specificity': null,

    // Logical longhands and the WebKit backdrop prefix are intentional compatibility choices.
    'declaration-block-no-redundant-longhand-properties': null,
    'property-no-vendor-prefix': null,

    // Existing semantic class names and case-sensitive font family names are intentional.
    'selector-class-pattern': null,
    'value-keyword-case': null,
  },
};
