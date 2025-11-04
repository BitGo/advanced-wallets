# IBM HPVS Integration

Master bitgo express and Advanced wallet manager is deployable on an IBM HPVS. The HPVS offers a secure environment to host the AWM, and a bus-connected HSM that is connected to the machine hosting the HPVS. Some might consider using IBM's HPVS as a part of their solution due to these stated features. This md provides a quick guide on how to integrate with IBM's environment.

Please note that BitGo does not provide direct support to your IBM integration. This md only gives documentation to the process and some common roadblocks that you might face during the integration process. Please contact your IBM support team for official guidance and support.

## Architecture Overview

The advanced wallet system typically comes with 3 separate applications - Master bitgo express, Advanced wallet manager, and a KMS API that interacts with the HSM. 

Host all three of these application on HPVS via podman containers. You should request access to IBM's HSM and secure storage during your integration.

## Big-endian hardware
Note that IBM's HPVS is run on the IBM LinuxONE Machine, which has the linux s390x architecture. Unlike other common architectures, linux s390x is a [big-endian architecture](https://en.wikipedia.org/wiki/Endianness). Keep this in mind during your integration, as not all software (especially Javascript libraries) support big-endianness.

## Contracts
A HPVS instance is deployed via a [contract](https://www.ibm.com/docs/en/hpvs/2.1.x?topic=servers-about-contract). A contract is a yaml file that tells the machine what to do during startup, and consists of 2 major parts - workload and env.

### Docker images
During deployment, IBM HPVS will take in your docker compose and build up the container. However, HPVS cannot build the docker image via compose directly. Instead, you will need to build the image up against the s390x architecture first and upload it to a private podman repository. You will likely be given a podman repo from IBM that the HPVS can access, alongside its certificate and login credentials. Upload the built images (against s390x) to the repo.

#### Building images
When building podman images on s390x architecture, you might run into the following issue
```bash
Error relocating /bin/sh: RELRO protection failed: No error information
```
This is due to the SELinux protection on the IBM machine, which causes labeling issue when building the images. Add the option `--security-opt label=disable` to circumvent this issue.

### Workload
The workload provides all necessary information to what HPVS needs to do during startup, e.g. the docker compose of MBE and AWM, the docker images, and the certificate to the private podman repo all goes into this session. Workload also includes how the volume (or the persistent storage) is setup on the HPVS as well.

### Env
The env provides information to the cloud environment that is not known to the workload persona. It includes sections such as logging and volumes. If your solution involves the crypto-passthrough, you will have to set it up in this section as well.

### Contract encryption
After the workload and env section is populated correctly, you will need to encrypt these sections into a hash. Together, these hashes forms the contract required for the HPVS to start up. 

### Contract generator
IBM might provide you with a script that generates the encrypted contract for you, using the docker compose as input.

## Deploying the contract
Once you have the contract, following [this](https://www.ibm.com/docs/en/hpvs/2.1.x?topic=servers-setting-up-configuring-hyper-protect-virtual) guide to generate the ISO image required for the HPVS deployment.

When generating the ISO image, you will also need to specify a network configuration. Within the network configuration, you will specify the static IP of the HPVS instance as well. For example, if you network config specified the following:
```yaml
network:
  version: 2
  ethernets:
    enc7:
      dhcp4: true
    enc8:
      dhcp4: false
      addresses:
        - 0.0.0.0/19
```
Then your apps will be hosted at `http://0.0.0.0:<port of the app>`. Please note that you cannot specify this IP address to anything. Contact IBM for the correct static address for you.

## Setup domain XML
After generating the ISO image using the contract, you will then need to create a `domain.xml` file, which specifies where the ISO image is and what hardware does the HPVS need to deploy for the app to start up correctly. Section 14 of [this](https://www.ibm.com/docs/en/hpvs/2.1.x?topic=servers-setting-up-configuring-hyper-protect-virtual) guide provides you code snippet on the `domain.xml` as reference. The xml should also define the name of the HPVS instance. We will use the name `advanced-wallet` as an example.

## Starting the HPVS instance
Once all of the above setup is complete, you can start up the HPVS. First, you will need to run the following command once to define the HPVS instance. Once run, we can directly refer the HPVS instance as `advanced-wallet`:
```bash
virsh define <domain.xml>
```
You will need to only run the above command once, unless you change the xml file. If so, run `virsh undefine advanced-wallet` to first undefine and then the above command to re-define it.

Now that the HPVS instance is named and defined, we can start up the instance:
```bash
virsh start advanced-wallet --console
```

To see if the HPVS instance is running, run the following. You should see the name `advanced-wallet` in the output:
```bash
virsh list
```

To stop the HPVS instance, run the following command:

```bash
virsh shutdown advanced-wallet
```
You do not need to undefine and redefine the domain.xml to restart the HPVS instance. Note that the data stored in the volume should be persistent even if you shutdown and re-start up the HPVS instance.

## Changes required on your docker compose
1. Build using image sha directly instead of using Dockerfile. The contract does not support building the container image using the docker compose directly. Upload the image to a repo and add the SHA to the docker compose instead:
  ```bash
  podman push localhost/advanced-wallet-manager docker://<repo-ip>/advanced-wallet-manager:latest
    (push build image to repo-ip)
  skopeo inspect docker://<repo-ip>/advanced-wallet-manager:latest
    (fetch the SHA of the image)
  ```

  ```yaml
  services:
    advanced-wallet-manager:
      image:
        <repo-ip>/advanced-wallet-manager@sha256:<sha>
  ```

2. Set the volume in the docker compose. Your volume address should match where you mount your disk, as specified in your contract. For example, if your workload component of your contract looks something like:
```yaml
volumes:
  data:
    filesystem: "ext4"
    mount: "/mnt/data"
    seed: "1234"
```
then you are specifying that the HPVS should keep all files under the directory `/mnt/data` to be persistent. So your bind mount on your docker compose needs to match:
```yaml
services:
    advanced-wallet-manager:
      volume:
        - "/mnt/data:/data"
```
Note that `/mnt/data` is the address on the HPVS while `/data` is the virtual address on the container. If set up properly, all data stored in the container address `/data` by your application will persist even if you restart the HPVS.

3. Set up a DNS address on MBE. You might run into issue where the MBE cannot resolve http request due to not finding a correct DNS server IP address to resolve the domain name request. If so, simply add a public DNS server to the docker compose:
```yaml
services:
    advanced-wallet-manager:
      dns:
        - 8.8.8.8
```
