// Anuncios (AdMob) solo en Android por ahora: en iPhone la librería no se enlaza ni se carga.
module.exports = {
  dependencies: {
    'react-native-google-mobile-ads': { platforms: { ios: null } }
  }
};
