module.exports = {
  root: false,
  extends: ["../../.eslintrc.cjs"],
  parserOptions: {
    ecmaFeatures: { jsx: true },
  },
  env: {
    browser: true,
  },
};
