// Offline synthetic experiment; not an exported production authentication API.
// No custom cryptographic implementation: use RustCrypto PBKDF2.
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;
const MAX_INPUT: usize = 1024;
const SALT_LEN: usize = 16;
const OUTPUT_LEN: usize = 32;
static mut INPUT: [u8; MAX_INPUT + SALT_LEN + OUTPUT_LEN] = [0; MAX_INPUT + SALT_LEN + OUTPUT_LEN];

#[no_mangle]
pub extern "C" fn buffer_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(INPUT).cast::<u8>()
}

// The single-threaded lab invokes synchronously, with no imported callbacks.
// Layout: input[0..1024], salt[1024..1040], digest[1040..1072].
// Fixed work factor and output length; no attacker-selected work.
#[no_mangle]
pub extern "C" fn derive_210k(length: usize) -> u32 {
    if length == 0 || length > MAX_INPUT { return 0; }
    unsafe {
        let p = buffer_ptr();
        let input = core::slice::from_raw_parts(p, length);
        let salt = core::slice::from_raw_parts(p.add(MAX_INPUT), SALT_LEN);
        let output = core::slice::from_raw_parts_mut(p.add(MAX_INPUT + SALT_LEN), OUTPUT_LEN);
        pbkdf2_hmac::<Sha256>(input, salt, 210_000, output);
    }
    1
}
