import { FastestNodeClient, fetchBeacon, fetchBeaconByTime, type RandomnessBeacon } from 'drand-client'

export type VerifiedBeacon = RandomnessBeacon & { verified: boolean }

const DEFAULT_CHAIN_HASH = '8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce'
const DEFAULT_PUBLIC_KEY = '868f005eb8e6e4ca0a47c8a77cea a5309a47978a7c71bc5cce96366b5d7a569937c529eeda66c7293784a9402801af31'.replace(/\s+/g, '')

const DEFAULT_URLS = [
  'https://api.drand.sh',
  'https://drand.cloudflare.com',
]

export function createDrandClient(urls: string[] = DEFAULT_URLS) {
  const options = {
    disableBeaconVerification: false,
    noCache: false,
    chainVerificationParams: {
      chainHash: DEFAULT_CHAIN_HASH,
      publicKey: DEFAULT_PUBLIC_KEY,
    },
  }

  const client = new FastestNodeClient(urls, options)
  client.start()
  return client
}

export async function getLatestVerifiedBeacon(client: ReturnType<typeof createDrandClient>): Promise<VerifiedBeacon> {
  const beacon = await fetchBeacon(client)
  return {
    ...beacon,
    verified: true,
  }
}

export async function getBeaconForTime(client: ReturnType<typeof createDrandClient>, msSinceEpoch: number): Promise<VerifiedBeacon> {
  const beacon = await fetchBeaconByTime(client, msSinceEpoch)
  return {
    ...beacon,
    verified: true,
  }
}

export async function getBeaconForRound(client: ReturnType<typeof createDrandClient>, round: number): Promise<VerifiedBeacon> {
  const beacon = await fetchBeacon(client, round)
  return { ...beacon, verified: true }
}

export function stopDrandClient(client: ReturnType<typeof createDrandClient>): void {
  client.stop()
}


