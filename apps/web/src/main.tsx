import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { currentLang, loadStrings, StringsContext } from "./i18n";
import "./app.css";

const lang = currentLang();

void loadStrings(lang).then((strings) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <StringsContext.Provider value={strings}>
        <App lang={lang} />
      </StringsContext.Provider>
    </StrictMode>,
  );
});
