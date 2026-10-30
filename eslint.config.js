"use strict";

const js = require("@eslint/js");
const n = require("eslint-plugin-n");
const prettierRecommended = require("eslint-plugin-prettier/recommended");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
  },
  {
    ...n.configs["flat/recommended-script"],
    files: ["index.js"],
  },
  {
    files: ["test/**"],
    languageOptions: {
      ecmaVersion: 2017,
      globals: globals.jest,
    },
    rules: {
      // Unused params set a function's arity or throw from their defaults.
      "no-unused-vars": ["error", { args: "none" }],
      // Generators without yield test the sync-completion path.
      "require-yield": "off",
    },
  },
  prettierRecommended,
];
