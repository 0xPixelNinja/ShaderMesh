import { getAddress, keccak256, toUtf8Bytes } from "ethers";

export interface RequestAuthorization {
  creditId: string;
  requestId: string;
  requester: string;
  provider: string;
  model: string;
  expiry: number;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("messages contain an unsupported value");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

export function hashMessages(messages: unknown): string {
  return keccak256(toUtf8Bytes(canonicalJson(messages)));
}

/** The exact UTF-8 string signed with EIP-191 personal_sign/signMessage. */
export function canonicalRequestAuthorization(
  authorization: RequestAuthorization,
  messages: unknown
): string {
  const payload = {
    creditId: BigInt(authorization.creditId).toString(),
    expiry: authorization.expiry,
    messagesHash: hashMessages(messages),
    model: authorization.model,
    provider: getAddress(authorization.provider).toLowerCase(),
    requestId: authorization.requestId,
    requester: getAddress(authorization.requester).toLowerCase(),
  };
  return `ShaderMesh Inference Authorization v1\n${JSON.stringify(payload)}`;
}
