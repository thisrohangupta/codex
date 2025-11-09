import js from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const recommendedTypeScriptRules = tsPlugin.configs.recommended?.rules ?? {};
const recommendedReactRules = pluginReact.configs.recommended?.rules ?? {};
const recommendedReactHooksRules = pluginReactHooks.configs.recommended?.rules ?? {};

export default [
  {
    ignores: ["dist", "node_modules"]
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...js.configs.recommended.languageOptions?.globals
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: pluginReact,
      "react-hooks": pluginReactHooks
    },
    settings: {
      react: {
        version: "detect"
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      ...recommendedTypeScriptRules,
      ...recommendedReactRules,
      ...recommendedReactHooksRules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off"
    }
  }
];
