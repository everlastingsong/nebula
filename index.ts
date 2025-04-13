// build: browserify index.ts -p tsify > static/js/bundle.js

import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import { Token, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { deserializeAccount, deriveAssociatedTokenAddress } from "@orca-so/sdk";
import $ from "jquery";
import Decimal from "decimal.js";

console.log("bundle.js loading...");

const DEVNET_RPC_ENDPOINT = "https://api.devnet.solana.com";

const DEVTOKENS = [
    {symbol: "SOL", mint: new PublicKey("So11111111111111111111111111111111111111112"), decimals: 9},
    {symbol: "devUSDC", mint: new PublicKey("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k"), decimals: 6},
    {symbol: "devUSDT", mint: new PublicKey("H8UekPGwePSmQ3ttuYGPU1szyFfjZR4N53rymSFwpLPm"), decimals: 6},
    {symbol: "devSAMO", mint: new PublicKey("Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa"), decimals: 9},
    {symbol: "devTMAC", mint: new PublicKey("Afn8YB1p4NsoZeS5XJBZ18LTfEy5NFPwN46wapZcBQr6"), decimals: 6},
];

const connection = new Connection(DEVNET_RPC_ENDPOINT, "confirmed");
const adapter = new PhantomWalletAdapter();
let connected: boolean = false;

function toastr(toast_type, message) {
    $(window).prop("toastr")[toast_type](message);
}
function notify_success(message) { toastr("success", message); }
function notify_info(message) { toastr("info", message); }
function notify_warning(message) { toastr("warning", message); }
function notify_failed(message) { toastr("error", message); }

async function check_wallet_connection() {
    const new_connected = adapter !== null && adapter.connected;
    $("#airdrop, [id^='swap_']").prop("disabled", !connected);

    const old_connected = connected;
    connected = new_connected;

    if ( old_connected && !new_connected ) await wallet_disconnected();
    if ( !old_connected && new_connected ) await wallet_connected();
}

async function wallet_disconnected() {
    console.log("disconnected");
    clear_balance();
    notify_warning("wallet disconnected");
}
async function wallet_connected() {
    console.log("connected");
    await update_balance();
}

function scaled(amount: Decimal, scale: number): string {
    const pow10 = new Decimal(10).pow(scale);
    return amount.div(pow10).toFixed(scale);
}

async function get_balance(wallet_pubkey: PublicKey) {
    const accounts = await Promise.all(DEVTOKENS.map(async (token) => {
        const ata = await Token.getAssociatedTokenAddress(ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, token.mint, wallet_pubkey);
        return token.symbol === "SOL" ? wallet_pubkey : ata;
    }));
    console.log("accounts", accounts);

    const account_infos = await connection.getMultipleAccountsInfo(accounts);
    console.log("account_infos", account_infos);
    const balance = account_infos.map((info, i) => {
        const token = DEVTOKENS[i];

        let amount: string = null;
        if ( info === null ) { // ATAは存在しない可能性が高いが、SOLアカウントも残高0だとnullなので注意
            amount = scaled(new Decimal(0), token.decimals);
        } else if ( token.symbol === "SOL" ) {
            amount = scaled(new Decimal(info.lamports), token.decimals);
        } else {
            amount = scaled(new Decimal(deserializeAccount(<Buffer>info.data).amount.toString()), token.decimals);
        }
        return {...token, amount};
    });

    console.log("balance", balance);
    return balance;
}

function clear_balance() {
    const terminal = $("#terminal");

    // calc width
    const symbol_max_len = Math.max(...DEVTOKENS.map((token) => token.symbol.length));

    let output = "";
    output = output + "Pubkey".padEnd(symbol_max_len + 3, " ") + "xxxxx...xxxxx" + "\n";
    output = output + "Network".padEnd(symbol_max_len + 3, " ") + "Devnet" + "\n";
    output = output + "\n";
    output = output + "Balance" + "\n";
    output = output + "\n";
    for ( let i=0; i<DEVTOKENS.length; i++ ) {
        output = output + DEVTOKENS[i].symbol.padEnd(symbol_max_len + 3, " ") + "--" + "\n";
    }

    terminal.text(output);
}

async function update_balance() {
    const terminal = $("#terminal");
    const pubkey_b58 = adapter.publicKey.toBase58();
    const short_wallet_pubkey = pubkey_b58.substring(0, 5) + "..." + pubkey_b58.substring(pubkey_b58.length - 5);
    console.log(short_wallet_pubkey);

    let balance = null;
    try {
        balance = await get_balance(adapter.publicKey);
    } catch ( err ) {
        console.log("err.message", err.message);
        clear_balance();
        notify_failed("cannot get balance");
    }

    // calc width
    const symbol_max_len = Math.max(...DEVTOKENS.map((token) => token.symbol.length));
    const integer_max_len = Math.max(...balance.map((token) => token.amount.split(".")[0].length));

    let output = "";
    output = output + "Pubkey".padEnd(symbol_max_len + 3, " ") + short_wallet_pubkey + "\n";
    output = output + "Network".padEnd(symbol_max_len + 3, " ") + "Devnet" + "\n";
    output = output + "\n";
    output = output + "Balance" + "\n";
    output = output + "\n";
    for ( let i=0; i<balance.length; i++ ) {
        const symbol = balance[i].symbol;
        const [integer, decimal] = balance[i].amount.split(".");

        output = output
               + symbol.padEnd(symbol_max_len + 3, " ")
               + integer.padStart(integer_max_len, " ")
               + "."
               + decimal
               + "\n";
    }

    terminal.text(output);
    notify_success("balance updated");
}

async function swap( mint: PublicKey ) {
    const DEVTOKEN_DISTRIBUTOR_PROGRAM_ID = new PublicKey("Bu2AaWnVoveQT47wP4obpmmZUwK9bN9ah4w6Vaoa93Y9");
    const DEVTOKEN_ADMIN = new PublicKey("3otH3AHWqkqgSVfKFkrxyDqd2vK6LcaqigHrFEmWcGuo");
    const PDA = new PublicKey("3pgfe1L6jcq59uy3LZmmeSCk9mwVvHXjn21nSvNr8D6x");

    try {
        notify_info("swap prepairing...");

        const vault = await deriveAssociatedTokenAddress(PDA, mint);
        const user_vault = await deriveAssociatedTokenAddress(adapter.publicKey, mint);
  
        const ix = new TransactionInstruction({
          programId: DEVTOKEN_DISTRIBUTOR_PROGRAM_ID,
          keys: [
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: vault, isSigner: false, isWritable: true },
            { pubkey: PDA, isSigner: false, isWritable: false },
            { pubkey: adapter.publicKey, isSigner: true, isWritable: true },
            { pubkey: user_vault, isSigner: false, isWritable: true },
            { pubkey: DEVTOKEN_ADMIN, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: Buffer.from([0xBF, 0x2C, 0xDF, 0xCF, 0xA4, 0xEC, 0x7E, 0x3D]), // instruction code for distribute
        });
  
        const tx = new Transaction();
        tx.add(ix);
        tx.feePayer = adapter.publicKey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        notify_info("swap requesting...");
        const signature = await adapter.sendTransaction(tx, connection);
        console.log("signature", signature);
        notify_info("swap requested");
        await connection.confirmTransaction(signature);
        notify_success("swap success");
        await update_balance();
    } catch ( err ) {
        console.log("err.message", err.message);
        notify_failed("swap failed");
    }
}

async function button_connect_phantom_onclick() {
    console.log("button_connect_phantom_onclick");
    try {
        await adapter.connect();
        notify_success("connected to Phantom");
    } catch ( err ) {
        console.log("err.message", err.message);
        notify_failed("cannot connect to Phantom");
    }
}

async function button_airdrop_onclick() {
    console.log("button_airdrop_onclick");
    try {
        notify_info("airdrop requesting...");
        const signature = await connection.requestAirdrop(adapter.publicKey, 1_000_000_000);
        console.log("signature", signature);
        notify_info("airdrop requested");
        await connection.confirmTransaction(signature);
        notify_success("airdrop success");
        await update_balance();
    } catch ( err ) {
        console.log("err.message", err.message);
        notify_failed("airdrop failed");
    }
}

async function button_swap_sol2devusdc_onclick() {
    console.log("button_swap_sol2devusdc_onclick");
    const mint = DEVTOKENS.filter((token) => token.symbol === "devUSDC")[0].mint;
    swap(mint);
}

async function button_swap_sol2devusdt_onclick() {
    console.log("button_swap_sol2devusdt_onclick");
    const mint = DEVTOKENS.filter((token) => token.symbol === "devUSDT")[0].mint;
    swap(mint);
}

async function button_swap_sol2devsamo_onclick() {
    console.log("button_swap_sol2devsamo_onclick");
    const mint = DEVTOKENS.filter((token) => token.symbol === "devSAMO")[0].mint;
    swap(mint);
}

async function button_swap_sol2devtmac_onclick() {
    console.log("button_swap_sol2devtmac_onclick");
    const mint = DEVTOKENS.filter((token) => token.symbol === "devTMAC")[0].mint;
    swap(mint);
}

$(window).on("load", function() {
    console.log("onaload...");
    clear_balance();

    // start checking
    setInterval(check_wallet_connection, 500);

    // set event handlers
    $("#connect_phantom").on("click", button_connect_phantom_onclick);
    $("#airdrop").on("click", button_airdrop_onclick);
    $("#swap_sol2devusdc").on("click", button_swap_sol2devusdc_onclick);
    $("#swap_sol2devusdt").on("click", button_swap_sol2devusdt_onclick);
    $("#swap_sol2devsamo").on("click", button_swap_sol2devsamo_onclick);
    $("#swap_sol2devtmac").on("click", button_swap_sol2devtmac_onclick);
});