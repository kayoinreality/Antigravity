import { View, Text } from 'react-native'
import { StyleSheet } from 'react-native-unistyles' // Importamos o StyleSheet DA LIB, não do react-native

// 1. Criamos usando StyleSheet.create
const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: 'bold',
  }
}))

export default function Home() {
  // 2. NÃO PRECISA MAIS DO HOOK useStyles!
  // O objeto 'styles' acima já é reativo. O C++ cuida de tudo.

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Antigravity</Text>
      <Text style={[styles.text, { fontSize: 14, marginTop: 10 }]}>
        Rodando Unistyles v3
      </Text>
    </View>
  )
}