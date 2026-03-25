import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated'

interface FABProps {
  onPress: () => void
  icon?: string
  label?: string
  color?: string
  bottom?: number
  right?: number
}

export default function FAB({
  onPress,
  icon = '+',
  label,
  color = '#6C5CE7',
  bottom = 32,
  right = 24,
}: FABProps) {
  const scale = useSharedValue(1)

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    <Animated.View style={[styles.container, { bottom, right }, animStyle]}>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: color }]}
        onPress={onPress}
        onPressIn={() => { scale.value = withSpring(0.93, { damping: 15 }) }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 12 }) }}
        activeOpacity={1}
      >
        <Text style={styles.icon}>{icon}</Text>
        {label && <Text style={styles.label}>{label}</Text>}
      </TouchableOpacity>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    height: 56,
    borderRadius: 28,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  icon: {
    fontSize: 22,
    color: '#fff',
    fontWeight: '300',
    lineHeight: 24,
  },
  label: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '600',
    letterSpacing: -0.2,
  },
})