"""Terminate every local lease whose provider has missed a heartbeat.

RentalMarket.terminate() is permissionless but nothing calls it automatically,
so the demo triggers it on request. Run through scripts/demo.ps1 (enforce), which
pipes this file into the seed container so it uses the local chain and addresses.
"""

import os

from chain import ChainClient, load_deployment

dep = load_deployment(os.environ["DEPLOYMENTS_FILE"])
caller = ChainClient.from_unlocked_account(os.environ["RPC_URL"], dep, 0)
rental = caller.rental
found = 0
for lease_id in range(1, caller.call(rental.functions.nextLeaseId())):
    if caller.call(rental.functions.isDown(lease_id)):
        caller.tx(rental.functions.terminate(lease_id))
        print(f"terminated lease {lease_id}: provider bond slashed, escrow refunded")
        found += 1
if not found:
    print("no lease is past its heartbeat deadline yet")
