import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'web/**/*', 'android/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
