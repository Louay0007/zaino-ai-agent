//! OS-keychain custody for the per-device gateway key.
//!
//! One entry: service `ai.zaino.desktop`, account `gateway-key` (M1; M4
//! introduces per-device accounts). No plaintext fallback anywhere —
//! `NoEntry` means logged out, `NoStorageAccess`/`PlatformFailure` mean
//! "unlock guidance, then re-login". A missing/broken store is NEVER a
//! reason to write the key to disk (hard req. 2).

use keyring::Entry;
use serde::{Deserialize, Serialize};

use super::{KEYCHAIN_SERVICE, KEYCHAIN_USER};
use crate::gateway::error::GatewayError;

/// Read the stored key. `Ok(None)` = no key stored (logged-out state).
/// Never throws for a missing entry: absence is a state, not an error.
pub fn read_key() -> Result<Option<String>, GatewayError> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| {
        GatewayError::KeychainUnavailable(format!("keychain open failed: {e}"))
    })?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(GatewayError::KeychainUnavailable(format!(
            "keychain read failed: {e:?}"
        ))),
    }
}

/// Persist the key (create or overwrite the single entry).
pub fn write_key(key: &str) -> Result<(), GatewayError> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| {
        GatewayError::KeychainUnavailable(format!("keychain open failed: {e}"))
    })?;
    entry.set_password(key).map_err(|e| {
        GatewayError::KeychainUnavailable(format!("keychain write failed: {e:?}"))
    })
}

/// Delete the entry. Missing entry still counts as success (logout must be
/// idempotent — a half-finished first logout must be re-runnable).
pub fn delete_key() -> Result<(), GatewayError> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| {
        GatewayError::KeychainUnavailable(format!("keychain open failed: {e}"))
    })?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(GatewayError::KeychainUnavailable(format!(
            "keychain delete failed: {e:?}"
        ))),
    }
}

/// Account metadata minted by the portal at device approval (email, org
/// name). Stored in a separate keychain entry so logout clears credentials
/// and identity together, and so `gateway_status` can render account
/// details on restart without re-approving. Display data only — no secret
/// material.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAccount {
    pub email: String,
    pub org_name: String,
}

const KEYCHAIN_ACCOUNT: &str = "gateway-account";

/// Read the stored account. `Ok(None)` = none stored.
pub fn read_account() -> Result<Option<StoredAccount>, GatewayError> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| {
        GatewayError::KeychainUnavailable(format!("keychain open failed: {e}"))
    })?;
    match entry.get_password() {
        Ok(pw) => serde_json::from_str(&pw)
            .map(Some)
            .map_err(|e| GatewayError::KeychainUnavailable(format!("account parse failed: {e}"))),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(GatewayError::KeychainUnavailable(format!(
            "keychain read failed: {e:?}"
        ))),
    }
}

/// Persist the account (create or overwrite the single entry).
pub fn write_account(account: &StoredAccount) -> Result<(), GatewayError> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| {
        GatewayError::KeychainUnavailable(format!("keychain open failed: {e}"))
    })?;
    let json = serde_json::to_string(account).map_err(|e| {
        GatewayError::KeychainUnavailable(format!("account serialize failed: {e}"))
    })?;
    entry.set_password(&json).map_err(|e| {
        GatewayError::KeychainUnavailable(format!("keychain write failed: {e:?}"))
    })
}

/// Delete the account entry. Missing entry still counts as success.
pub fn delete_account() -> Result<(), GatewayError> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| {
        GatewayError::KeychainUnavailable(format!("keychain open failed: {e}"))
    })?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(GatewayError::KeychainUnavailable(format!(
            "keychain delete failed: {e:?}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Store tests need a real OS keychain and are environment-sensitive
    // (headless Linux has no Secret Service daemon), so they live behind an
    // explicit opt-in, not in the default suite. The pure state machine
    // (live-key set/clear) is covered in `super`'s tests.
    //
    // Run with: `cargo test -p ccgui gateway::store -- --ignored`
    #[test]
    #[ignore]
    fn keychain_roundtrip_when_backend_present() {
        const USER: &str = "gateway-key-m1-test";
        let entry = Entry::new(KEYCHAIN_SERVICE, USER).expect("open entry");
        entry.set_password("zn-test-key").expect("write");
        assert_eq!(entry.get_password().expect("read"), "zn-test-key");
        entry.delete_credential().expect("delete");
        assert!(matches!(
            entry.get_password(),
            Err(keyring::Error::NoEntry)
        ));
    }
}
