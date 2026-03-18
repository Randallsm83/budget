export const metadata = {
  title: "Privacy Policy | Budget",
  description: "Privacy policy for the Personal Budget Application",
};

export default function PrivacyPage() {
  const effectiveDate = "March 18, 2026";

  return (
    <main className="max-w-3xl mx-auto px-6 py-12 text-sm leading-relaxed text-gray-200">
      <h1 className="text-2xl font-bold mb-1">Privacy Policy</h1>
      <p className="text-gray-400 mb-8">Effective Date: {effectiveDate}</p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">1. Overview</h2>
        <p>
          This Privacy Policy describes how the Personal Budget Application ("the App," "we," "us") collects,
          uses, stores, and deletes your personal and financial information. By using the App, you agree to
          the practices described in this policy.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">2. Information We Collect</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Email address and hashed password for authentication</li>
          <li>Bank account names, types, and balances (via Plaid)</li>
          <li>Transaction records: date, amount, payee, and category</li>
          <li>Budget and category data you enter manually</li>
          <li>Plaid access tokens (encrypted at rest using AES-256-GCM)</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">3. How We Use Your Information</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>To provide budgeting and financial tracking functionality</li>
          <li>To sync your bank transactions via the Plaid API</li>
          <li>To authenticate your identity and secure your account</li>
        </ul>
        <p className="mt-2">
          We do not sell, share, or disclose your personal or financial data to any third party except
          Plaid, which is used solely to retrieve your transaction and account data on your behalf.
          Plaid&apos;s privacy policy is available at{" "}
          <a
            href="https://plaid.com/legal/#end-user-privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline"
          >
            plaid.com/legal/#end-user-privacy-policy
          </a>
          .
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">4. Data Storage and Security</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>All data is stored in a PostgreSQL database with encryption at rest</li>
          <li>All data in transit is protected by TLS 1.2 or higher</li>
          <li>Plaid access tokens are encrypted using AES-256-GCM</li>
          <li>Passwords are hashed using bcrypt and never stored in plaintext</li>
          <li>Database access is restricted to the application server only</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">5. Data Retention and Deletion</h2>
        <p>
          Your data is retained for as long as your account is active. You may request deletion of your
          account and all associated data at any time by contacting us at the email address below.
          Upon request, all your data — including transactions, accounts, budget data, and linked bank
          connections — will be permanently deleted within 30 days. Plaid access tokens will be revoked
          via the Plaid API at the time of deletion.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">6. Your Consent</h2>
        <p>
          By connecting your bank account through Plaid Link, you consent to the collection, storage,
          and processing of your financial data as described in this policy. You may revoke this consent
          at any time by disconnecting your bank account within the App or by requesting account deletion.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">7. Children&apos;s Privacy</h2>
        <p>
          The App is not intended for use by individuals under the age of 18. We do not knowingly
          collect personal information from minors.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">8. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Continued use of the App after any
          changes constitutes acceptance of the updated policy. The effective date above reflects the
          date of the most recent revision.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">9. Contact</h2>
        <p>
          For questions, data deletion requests, or privacy concerns, contact:{" "}
          <a href="mailto:randallsm83@gmail.com" className="text-blue-400 underline">
            randallsm83@gmail.com
          </a>
        </p>
      </section>

      <p className="text-gray-500 text-xs mt-12">
        Personal Budget Application &mdash; Privacy Policy v1.0 &mdash; {effectiveDate}
      </p>
    </main>
  );
}
