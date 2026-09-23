# ShaderMesh leased GPU sandbox.
#
# A requester who leases GPU capacity gets a shell on this image with the
# provider's GPU attached. It carries the CUDA runtime libraries and an SSH
# daemon so the lease is something a requester can actually connect to and use.
#
# SECURITY: granting interactive shell access is a deliberate relaxation of the
# task-execution sandbox. Containers started from this image keep CPU, memory and
# PID limits, but they need a network, a writable filesystem and a privileged
# entrypoint to run sshd. Run it only for leases a provider has accepted.
FROM nvidia/cuda:12.4.1-base-ubuntu22.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openssh-server \
        ca-certificates \
        python3 \
        procps \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/run/sshd

# Password login is enabled because the lease credential is a generated, single
# lease secret delivered to the requester out of band, not a user-chosen password.
RUN sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config \
    && sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i 's/^#\?UseDNS.*/UseDNS no/' /etc/ssh/sshd_config \
    && printf 'PrintMotd no\nAcceptEnv LANG LC_*\n' >> /etc/ssh/sshd_config

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
