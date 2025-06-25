import { useEffect } from "react";
import { View, Button, Text } from "react-native";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";

const REDIRECT_URI = "mobile://callback";
const LOGIN_URL = "https://mobileapp-4r30.onrender.com/auth/login";

export default function Index() {
  useEffect(() => {
    const handleDeepLink = async ({ url }: { url: string }) => {
      const { queryParams } = Linking.parse(url);
      const code = queryParams?.code as string;

      if (code) {
        try {
          const response = await fetch("https://mobileapp-4r30.onrender.com/auth/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, redirect_uri: REDIRECT_URI }),
          });
          const data = await response.json();

          await SecureStore.setItemAsync("access_token", data.access_token);
          await SecureStore.setItemAsync("refresh_token", data.refresh_token);

          console.log("Token saved!");
        } catch (e) {
          console.error("Failed to exchange code", e);
        }
      }
    };

    const sub = Linking.addEventListener("url", handleDeepLink);
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink({ url });
    });

    return () => sub.remove();
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Spotify Login</Text>
      <Button title="Login with Spotify" onPress={() => Linking.openURL(LOGIN_URL)} />
    </View>
  );
}
