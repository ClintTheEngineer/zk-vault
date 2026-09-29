# Cander ZK Vault 🔐

**A simple, privacy-first encrypted file vault that runs entirely in your browser.**

Cander ZK Vault is a client-side encrypted file vault designed around a straightforward idea:

> **Your files should be encrypted before they leave your device.**

No account. No cloud service. No backend required. No telemetry required.

Create an encrypted vault, add the files and folders you want to protect, and export a portable `.zkv` vault that you can store wherever you choose.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-supported-purple.svg)](#progressive-web-app)
[![Privacy](https://img.shields.io/badge/privacy-client--side-green.svg)](#privacy-by-design)

> **⚠️ Security status:** Cander ZK Vault is an experimental open-source project and has **not undergone an independent security audit**. Do not rely on it as the sole protection for irreplaceable or extremely high-value data. See [Security & Limitations](#security--limitations).


Demo at: https://zk-vault-1iu7.onrender.com/
---

## ✨ Why Cander?

Most cloud storage makes encryption feel like someone else's problem.

Cander takes the opposite approach.

Your browser handles the encryption. The resulting vault is an encrypted artifact that you control.

```text
        Your files
            │
            ▼
      ┌─────────────┐
      │   Cander    │
      │  ZK Vault   │
      └─────────────┘
            │
       Encrypt locally
            │
            ▼
      ┌─────────────┐
      │  encrypted  │
      │    .zkv     │
      └─────────────┘
            │
            ▼
     Store it anywhere
```

Cander doesn't need to know what is inside your vault.

You don't need to trust a cloud provider with plaintext files.

And you don't need to create an account just to encrypt something.

---

# 🚀 Features

### 🔐 Client-side encryption

Files are encrypted in your browser rather than uploaded to a server for processing.

Your plaintext files don't need to leave your device in order for Cander to create a vault.

### 📦 Portable `.zkv` vaults

Your encrypted data can be exported as a single vault file.

That means you can treat a vault as an encrypted artifact:

```text
My Documents.zkv
```

Copy it to another drive.

Back it up.

Store it on cloud storage.

Put it on a USB drive.

Send the encrypted file somewhere you don't necessarily trust.

Without the password, the vault remains encrypted.

### 📁 Create a vault first

Cander supports two complementary workflows.

#### Quick encryption

Select files or folders and encrypt them.

Perfect when you simply want to protect something quickly.

#### Create a vault

Create an empty vault first, then add files and folders to it.

This lets you build a vault from files that don't currently live together:

```text
Documents/
    passport.pdf

Pictures/
    driver's-license.jpg

Taxes/
    2025-return.pdf
```

All three can become part of the same encrypted vault without first rearranging your real filesystem.

This also lets you organize the contents of the vault independently from the location of the original files.

### 🗂️ Encrypted organization

A vault isn't just a collection of encrypted blobs.

Cander is designed to protect the contents **and the organization of those contents**, including the vault's file/folder structure.

### 🌐 Browser-native

Cander is designed as a web application/PWA rather than a traditional desktop application.

That means there is no heavyweight installation requirement and the same application can run across supported browsers and devices.

### 📴 Local-first

Cander is designed around local processing.

The encryption workflow does not fundamentally depend on a Cander-operated server.

This makes the application particularly well suited to privacy-conscious users and self-hosters.

### 👤 No account required

There is no reason to create a Cander account just to use an encryption tool.

Your vault belongs to you.

### 🛡️ Modern cryptography

Cander uses modern, well-established cryptographic primitives rather than inventing its own encryption algorithm.

* **Argon2id** for password-based key derivation
* **XChaCha20-Poly1305** for authenticated encryption

The goal is deliberately boring cryptography:

> Don't invent a cipher. Build the application around established primitives.

Argon2id is designed to make password guessing more expensive, while XChaCha20-Poly1305 provides authenticated encryption so that tampering with encrypted data can be detected.

---

# 🧭 How It Works

Cander is intentionally simple from the user's perspective.

## 1. Create or select a vault

Either:

* encrypt a selection immediately, or
* create an empty vault and add content to it.

## 2. Add files and folders

Files can be selected from their existing locations.

You don't need to reorganize your real filesystem just to create a vault.

## 3. Protect the vault

Choose a password.

Cander derives the cryptographic key from the password using Argon2id.

## 4. Encrypt

The vault contents are encrypted locally.

## 5. Export

Cander produces a portable `.zkv` vault.

That's it.

---

# 🔒 Privacy by Design

Cander's architecture is based on minimizing what the application needs to know.

There is no inherent need for:

* user accounts
* cloud storage
* a Cander database
* server-side file processing
* server-side password verification
* analytics
* advertising

The intended trust boundary looks like this:

```text
                 ┌──────────────────────────┐
                 │        Your device       │
                 │                          │
 Files ─────────►│       Cander ZK Vault    │
                 │            │             │
                 │       Encryption         │
                 │            │             │
                 └────────────┼─────────────┘
                              │
                              ▼
                       encrypted .zkv
                              │
                              ▼
                     Wherever YOU choose
```

The storage provider doesn't need to be part of the cryptographic trust model.

You can store the resulting vault on your own server, cloud storage, removable media, or another location of your choosing.

---

# 🧪 Project Status

Cander ZK Vault is **experimental software**.

The project is functional, but it should not currently be treated as audited security software.

In particular:

* The cryptographic implementation has not received an independent professional audit.
* Browser security is part of the overall security model.
* A compromised device can potentially compromise data before encryption or after decryption.
* A compromised browser or malicious modified deployment can undermine client-side security.
* Losing your password can mean losing access to your vault.
* Cander cannot recover a forgotten password for you.
* Backups of your `.zkv` files are your responsibility.

**Do not mistake "encrypted" for "invulnerable."**

The goal of this project is to provide a strong, transparent foundation for local/client-side encrypted storage while remaining honest about what has and hasn't been independently verified.

---

# 🔑 Your Password Matters

Argon2id can make password guessing substantially more expensive, but it cannot make a weak password strong.

A password such as:

```text
password123
```

is still a terrible password.

A long, unique password or passphrase is strongly recommended.

Your vault is only as secure as the credentials protecting it and the devices on which you use it.

---

# 🧑‍💻 Self-Hosting

Cander is particularly well suited to self-hosting.

You can serve the application from infrastructure you already control rather than depending on a hosted Cander service.

For example:

```text
Internet
    │
    ▼
Your domain
    │
    ▼
Your web server
    │
    ▼
Cander ZK Vault
```

It can therefore fit naturally into a privacy-focused homelab or self-hosted environment.

The application itself does not require a Cander-controlled backend to perform its core encryption workflow.

---

# 📱 Progressive Web App

Cander is designed to work as a Progressive Web App.

When supported by the browser/platform, it can be installed like an application rather than being treated simply as a normal website.

This makes Cander particularly useful for a workflow where the user wants a dedicated encryption tool without installing a traditional desktop application.

---

# 🧰 Technology

Cander ZK Vault is built as a modern browser application.

The project intentionally keeps the architecture relatively small.

The cryptographic design centers around:

| Purpose                       | Primitive                     |
| ----------------------------- | ----------------------------- |
| Password-based key derivation | **Argon2id**                  |
| Authenticated encryption      | **XChaCha20-Poly1305**        |
| Storage artifact              | **`.zkv` encrypted vault**    |
| Application model             | **Client-side / local-first** |
| Delivery                      | **Web app / PWA**             |

The project favors established cryptographic primitives over custom cryptography.

---

# 🆚 Why Not Just Use Cryptomator?

Cryptomator is an excellent project and solves a somewhat different problem.

Cryptomator is primarily designed to provide an encrypted filesystem layer over storage.

Cander takes a simpler approach:

> **Create an encrypted, portable vault in your browser.**

Cander doesn't attempt to replace a full encrypted filesystem.

Instead, it aims to make one particular task extremely approachable:

**Take some files → encrypt them locally → get a portable encrypted vault.**

If you want a transparent encrypted filesystem mounted on your computer, Cryptomator may be the better tool.

If you want a simple browser-native encrypted vault artifact, Cander is designed for that.

---

# 🆚 Why Not Just Use Cloud Storage Encryption?

Because the architecture matters.

With ordinary cloud storage, your files are typically uploaded to someone else's infrastructure and protected according to that provider's security model.

With Cander, the intended workflow is:

```text
Plaintext
   ↓
Your device
   ↓
Cander
   ↓
Encrypted vault
   ↓
Storage provider
```

The storage provider receives the encrypted artifact rather than needing access to the plaintext.

This means Cander can be used **on top of storage you already trust only for availability rather than confidentiality**.

---

# 🗺️ Roadmap

The roadmap is intentionally conservative.

Possible future work includes:

* additional vault management improvements
* stronger cross-browser compatibility
* improved mobile experience
* additional testing and test vectors
* improved documentation
* expanded vault format documentation
* security review/audit
* additional recovery and usability features

Security and reliability improvements take priority over feature count.

---

# 🤝 Contributing

Cander is open source because privacy tools benefit from public scrutiny.

If you find a bug, have an idea, or want to improve the project:

1. Open an issue.
2. Explain the problem or proposed change.
3. Include reproduction steps when reporting a bug.
4. For security-sensitive issues, please follow the project's security disclosure guidance rather than publicly exposing an exploitable vulnerability.

Contributions involving cryptography should be accompanied by particularly thorough documentation and testing.

---

# 🐛 Security Issues

**Please do not publicly disclose an active security vulnerability before there has been an opportunity to address it.**

If you believe you've found a vulnerability in Cander's encryption, key derivation, vault format, or another security-critical component, please report it privately through the security contact specified by the repository.

Security reports are welcome.

A small encryption project benefits enormously from people trying to break its assumptions.

---

# ❤️ Why Open Source?

Cander doesn't need you to trust a company.

It should be possible to inspect what the application does.

It should be possible to run it yourself.

It should be possible to understand its security model.

And, ideally, it should be possible for independent researchers to tell me when I've gotten something wrong.

That's the point of making Cander public.

**Privacy software should be scrutinized, not blindly trusted.**

---

# ⭐ Support the Project

If you find Cander useful, there are several ways to help.

### ⭐ Star the repository

A GitHub star helps other people discover the project and tells me that this is something worth continuing.

### 🐛 Report bugs

Real-world testing is incredibly valuable.

### 💡 Suggest improvements

Especially improvements that make strong privacy practices easier for ordinary users.

### 🔍 Review the code

If you have experience with browser security, cryptography, PWAs, or secure application design, your scrutiny is welcome.

### 💰 Sponsor the project

If Cander is useful to you and you'd like to help support continued development, sponsorship helps fund the time required for maintenance, testing, documentation, infrastructure, and eventually professional security review.

---

# ⚠️ Important Disclaimer

Cander ZK Vault is provided **as-is**, without guarantees that it is suitable for any particular security requirement.

It has **not been independently audited**.

Do not use experimental software as the sole protection for information where compromise or loss could cause serious harm.

Always maintain backups of important data.

Most importantly:

**Never forget your password.**

---

# 📜 License

See [LICENSE](LICENSE) for the project's license.

---

## Cander ZK Vault

**Private by design.
Portable by nature.
Open by choice.**

If you believe encrypted storage shouldn't require handing your data and your trust to someone else's server, Cander ZK Vault is for you.