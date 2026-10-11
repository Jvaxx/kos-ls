//@ts-check
'use strict';

const path = require('path');
const outDir = process.env.NODE_ENV && process.env.NODE_ENV === 'dev' ?
    '/out' :
    '/dist'


/**@type {import('webpack').Configuration}*/
const config = {
    target: 'node', // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
    entry: {
        // the language server, and the `kos-ls format` command
        server: path.join(__dirname, '/src/server.ts'),
        format: path.join(__dirname, '/src/cli/format.ts'),
    },
    output: {
        // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
        path: path.join(__dirname, outDir),
        filename: '[name].js',
        libraryTarget: 'commonjs2',
        devtoolModuleFilenameTemplate: '../[resource-path]'
    },
    devtool: 'source-map',
    resolve: {
        // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [{
            test: /\.ts$/,
            exclude: /node_modules/,
            use: {
                loader: 'ts-loader',
                options: {
                    configFile: 'tsconfig.json'
                },
            }
        }]
    },
};
module.exports = config;