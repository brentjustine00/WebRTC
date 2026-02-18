import { useState } from "react";

export default function Login({ onSuccess }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (password === import.meta.env.VITE_PRIVATE_ROOM_PASSWORD) {
      onSuccess();
      return;
    }
    setError("Incorrect password. Access denied.");
  };

  return (
    <div className="auth-shell">
      <form className="card login-card" onSubmit={submit}>
        <h1>Private Video Room</h1>
        <p>Enter the shared password to join.</p>
        <input
          type="password"
          placeholder="Room password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) {
              setError("");
            }
          }}
          autoComplete="off"
          required
        />
        {error ? <div className="error-text">{error}</div> : null}
        <button type="submit">Enter Room</button>
      </form>
    </div>
  );
}
