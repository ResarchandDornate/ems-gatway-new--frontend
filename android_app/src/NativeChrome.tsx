import { useEffect } from "react";

import { useTheme } from "../../mobile_app_kunal_backend/useTheme";
import { hideSplashAfterPaint, syncStatusBar } from "./native";

/**
 * Renders nothing; exists to run native side effects that need the theme.
 *
 * It has to be a child of MobileShell rather than a sibling, because the theme
 * lives in a context MobileShell provides — a sibling would read the default
 * and leave the status bar dark on a light phone. MobileShell passes children
 * through ThemeProvider, so mounting here is enough and no shared file changes.
 */
export function NativeChrome() {
  const { theme } = useTheme();

  useEffect(() => {
    void syncStatusBar(theme);
  }, [theme]);

  useEffect(hideSplashAfterPaint, []);

  return null;
}
