import { Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Collapsible } from '@/components/ui/collapsible';

export default function AppInfoScreen() {
  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Antigravity</ThemedText>
        <ThemedText>Notas flutuantes inspiradas em fluxo de pensamento do Obsidian.</ThemedText>
      </View>

      <Collapsible title="Como usar">
        <ThemedText>Crie notas em + Nova, arraste no mural e toque nelas para editar.</ThemedText>
      </Collapsible>

      <Collapsible title="Otimização iOS + Android">
        <ThemedText>
          Persistência local com MMKV, respostas táteis, modal com teclado adaptado e navegação com
          tab bar ajustada por plataforma.
        </ThemedText>
      </Collapsible>

      <Collapsible title="Estado atual do MVP">
        <ThemedText>
          O projeto já funciona offline e com tema claro/escuro. O próximo passo ideal é adicionar
          backlinks entre notas e busca textual.
        </ThemedText>
      </Collapsible>

      <ThemedText style={styles.footer}>
        {Platform.OS === 'ios'
          ? 'iOS: drag suave e teclado com comportamento nativo.'
          : 'Android: UI responsiva com tab bar compacta e persistência rápida.'}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
  },
  header: {
    marginBottom: 6,
    gap: 6,
  },
  footer: {
    marginTop: 8,
  },
});
