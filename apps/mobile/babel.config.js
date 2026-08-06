module.exports = function (api) {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { reanimated: false }]],
    // Must stay last. It rewrites the functions carrying the 'worklet'
    // directive so they can run on the UI thread — which is what keeps pan,
    // zoom and the black hole gesture off the JS thread entirely.
    plugins: ['react-native-worklets/plugin'],
  }
}
