import { PublicKey } from "@solana/web3.js";
import {
    WhirlpoolContext, AccountFetcher, ORCA_WHIRLPOOL_PROGRAM_ID, buildWhirlpoolClient,
    PDAUtil, ORCA_WHIRLPOOLS_CONFIG, WhirlpoolData, PoolUtil, swapQuoteByInputToken
} from "@orca-so/whirlpools-sdk";
import { Provider } from "@project-serum/anchor";
import { DecimalUtil, Percentage } from "@orca-so/common-sdk";
import Decimal from "decimal.js";

// THIS SCRIPT REQUIRES ENVIRON VARS!!!
// bash$ export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com 
// bash$ export ANCHOR_WALLET=~/.config/solana/id.json
// bash$ ts-node this_script.ts

const provider = Provider.env();
console.log("connection endpoint", provider.connection.rpcEndpoint);
console.log("wallet", provider.wallet.publicKey.toBase58());

async function main() {
    const ctx = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
    const fetcher = new AccountFetcher(ctx.connection);
    const client = buildWhirlpoolClient(ctx, fetcher);

    // ATTENTION!!
    //
    // all required tokens and pubkeys is provided here.
    //
    // https://everlastingsong.github.io/nebula/
    //
    // this site is NOT official.
    // yugure created and distributed these tokens and pools for only learning purpose.
    // you should use temporary wallet to receive tokens, even if you trust yugure. (thank you!)

    // get pool
    const NEBULA__WHIRLPOOLS_CONFIG = new PublicKey("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR");
    const devSAMO = {mint: new PublicKey("Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa"), decimals: 9};
    const devUSDC = {mint: new PublicKey("BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k"), decimals: 6};

    const tick_spacing = 64;
    const whirlpool_pubkey = PDAUtil.getWhirlpool(
        ORCA_WHIRLPOOL_PROGRAM_ID,
        NEBULA__WHIRLPOOLS_CONFIG,
        devSAMO.mint, devUSDC.mint, tick_spacing).publicKey;
    console.log("whirlpool_key", whirlpool_pubkey.toBase58());
    const whirlpool = await client.getPool(whirlpool_pubkey);

    // get swap quote
    const amount_in = new Decimal("1" /* devSAMO */);

    const aToB = true; // devSAMO to devUSDC direction
    const whirlpool_data = await whirlpool.refreshData(); // or whirlpool.getData()
    const tick_array_address = PoolUtil.getTickArrayPublicKeysForSwap(
        whirlpool_data.tickCurrentIndex,
        whirlpool_data.tickSpacing,
        aToB,
        ctx.program.programId,
        whirlpool_pubkey
    );
    const tick_array_sequence_data = await fetcher.listTickArrays(tick_array_address, true);

    const quote = swapQuoteByInputToken({
        whirlpoolAddress: whirlpool_pubkey,
        swapTokenMint: whirlpool_data.tokenMintA, // input is devSAMO
        whirlpoolData: whirlpool_data,
        tokenAmount: DecimalUtil.toU64(amount_in, devSAMO.decimals),
        amountSpecifiedIsInput: true, // tokenAmount means input amount of devSAMO
        slippageTolerance: Percentage.fromFraction(10, 1000), // acceptable slippage is 1.0% (10/1000)
        tickArrayAddresses: tick_array_address,
        tickArrays: tick_array_sequence_data,
    });

    // print quote
    console.log("aToB", quote.aToB);
    console.log("estimatedAmountIn", DecimalUtil.fromU64(quote.estimatedAmountIn, devSAMO.decimals).toString(), "devSAMO");
    console.log("estimatedAmountOut", DecimalUtil.fromU64(quote.estimatedAmountOut, devUSDC.decimals).toString(), "devUSDC");

    // execute transaction
    const tx = await whirlpool.swap(quote);
    const signature = await tx.buildAndExecute();
    console.log("signature", signature);
    ctx.connection.confirmTransaction(signature, "confirmed");
}

main();

/*
SAMPLE OUTPUT

$ ts-node src/nebula/01a_get_quote_and_swap_devsamo_devusdc.ts 
connection endpoint https://api.devnet.solana.com
wallet r21Gamwd9DtyjHeGywsneoQYR39C1VDwrw7tWxHAwh6
whirlpool_key EgxU92G34jw6QDG9RuTX9StFg1PmHuDqkRKAE5kVEiZ4
aToB true
estimatedAmountIn 1 devSAMO
estimatedAmountOut 0.009974 devUSDC
signature 4b3Uonm263FXFTeJi8QbQAtfYkXcRMXhnP7yZkardV5cQhBhprYRbXD4d4VNQeBLiWuvy8fY2PJ339huuZCCaEx8

*/
