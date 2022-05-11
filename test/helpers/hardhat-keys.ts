/**
 * WARNING!! DO NOT USE IN PRODUCTION OR WITH ANY FUNDS.
 * THESE PUBLIC/PRIVATE KEYS COME FROM HARDHAT AND ARE PUBLICLY KNOWN.
 */
export function findPrivateKey(publicKey: string): string {
  switch (publicKey.toLowerCase()) {
    case "0x70997970c51812dc3a010c7d01b50e0d17dc79c8":
      return "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

    case "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc":
      return "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

    case "0x90f79bf6eb2c4f870365e785982e1f101e93b906":
      return "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";

    case "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65":
      return "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";

    default:
      return "0x";
  }
}
