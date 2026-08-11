export default [
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      semi: ["error", "always"],
      quotes: ["error", "double"],
      "no-console": "warn",
    },
  },
];
