module.exports = {
    root: true,
    env: {
        es2022: true,
        node: true,
    },
    parserOptions: {
        ecmaVersion: 'latest',
    },
    rules: {
        'no-unused-vars': ['error', {
            args: 'after-used',
            argsIgnorePattern: '^_',
            caughtErrors: 'none',
            varsIgnorePattern: '^_',
        }],
    },
};
