/**
 * Entry route: decides between Registration and Player based on stored
 * screen identity. This is intentionally trivial so cold-start is fast.
 */
import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

import { loadScreenIdentity } from "@/src/services/secure-storage";
import { colors } from "@/src/theme";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const id = await loadScreenIdentity();
      if (id) {
        router.replace("/player");
      } else {
        router.replace("/register");
      }
    })();
  }, [router]);

  return (
    <View style={styles.container} testID="index-loader">
      <ActivityIndicator size="large" color={colors.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceInverse,
    alignItems: "center",
    justifyContent: "center",
  },
});
