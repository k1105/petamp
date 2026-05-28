export function CreditsPage() {
  return (
    <div className="page credits-page">
      <div className="credits-container">
        <h1 className="credits-title">Credits</h1>

        <section className="credits-section">
          <h2 className="credits-section-title">BPM Data</h2>
          <p className="credits-text">
            Song tempo and BPM data provided by{' '}
            <a
              className="credits-link"
              href="https://getsongbpm.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              GetSongBPM
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  )
}
