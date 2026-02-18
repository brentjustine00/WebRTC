export default function RingingModal({ open, onAccept, onDecline }) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay">
      <div className="modal card">
        <h2>Incoming Call</h2>
        <p>Someone is calling you.</p>
        <div className="row">
          <button className="btn-success" onClick={onAccept} type="button">
            Accept
          </button>
          <button className="btn-danger" onClick={onDecline} type="button">
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
