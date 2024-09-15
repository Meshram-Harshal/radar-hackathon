module.exports = {
  resolve: {
    fallback: {
      process: require.resolve('process/browser'),
      crypto: require.resolve('crypto-browserify'),
    },
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: 'process/browser',
    }),
  ],
};
