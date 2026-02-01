module.exports = {
  "ignorePatterns": [".eslintrc.js", "jest.config.js", "**/*.test.ts", "scripts/**"],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2020,
    "sourceType": "module",
    "project": "./tsconfig.json",
    "tsconfigRootDir": __dirname
  },
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "plugins": ["@typescript-eslint"],
  "rules": {
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-this-alias": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": ["error", {
      "argsIgnorePattern": "^_"
    }]
  },
  "env": {
    "browser": true,
    "node": true,
    "es6": true,
    "jest": true
  },
  "overrides": [
    {
      "files": ["rollup.cdn.config.mjs"],
      "parserOptions": {
        "project": null
      }
    },
    {
      "files": ["react/**/*.ts", "react/**/*.tsx"],
      "parserOptions": {
        "project": "./react/tsconfig.json",
        "tsconfigRootDir": __dirname
      }
    }
  ]
}
