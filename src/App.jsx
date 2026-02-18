import { useState } from "react";
import Login from "./components/Login";
import Call from "./components/Call";

function App() {
  const [authenticated, setAuthenticated] = useState(false);

  if (!authenticated) {
    return <Login onSuccess={() => setAuthenticated(true)} />;
  }

  return <Call onLogout={() => setAuthenticated(false)} />;
}

export default App;
