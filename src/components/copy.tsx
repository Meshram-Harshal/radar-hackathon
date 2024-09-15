import React, { useEffect, useState } from 'react';
import { PublicKey, Keypair, Transaction, Connection, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddress, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import LightProtocol from '@lightprotocol/stateless.js';
import CompressedToken from '@lightprotocol/compressed-token';
import BN from 'bn.js';

// Constants
const RPC_ENDPOINT = 'https://devnet.helius-rpc.com/?api-key=<api_key>';
const connection = new Connection(RPC_ENDPOINT);

declare global {
  interface Window {
    solana: any;
  }
}

interface TokenInfo {
  mintAddress: string;
  amount: string;
  selected: boolean;
}

const PhantomConnect: React.FC = () => {
  const [walletKey, setWalletKey] = useState<PublicKey | null>(null);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [signature, setSignature] = useState<string | null>(null);

  // Detect Phantom wallet provider
  const getProvider = () => {
    if ('solana' in window) {
      const provider = window.solana;
      if (provider?.isPhantom) {
        return provider;
      }
    }
    window.open('https://phantom.app/', '_blank');
  };

  // Connect to the wallet
  const connectWallet = async () => {
    const provider = getProvider();
    if (provider) {
      try {
        const resp = await provider.connect();
        setWalletKey(resp.publicKey);
        console.log('Connected with publicKey:', resp.publicKey.toString());
        fetchTokens(resp.publicKey);
      } catch (err) {
        console.log('Connection error:', err);
      }
    }
  };

  // Fetch token balances
  const fetchTokens = async (publicKey: PublicKey) => {
    try {
      const tokenAccountsList = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID });
      const tokensInfo: TokenInfo[] = tokenAccountsList.value.map((tokenAccountInfo: any) => {
        const accountData = tokenAccountInfo.account.data.parsed.info;
        const mintAddress = accountData.mint;
        const amount = accountData.tokenAmount.uiAmountString;
        return {
          mintAddress,
          amount,
          selected: false,
        };
      });

      setTokens(tokensInfo);
    } catch (error) {
      console.log('Error fetching tokens:', error);
    }
  };

  // Disconnect from the wallet
  const disconnectWallet = async () => {
    const provider = getProvider();
    if (provider) {
      try {
        await provider.disconnect();
        setWalletKey(null);
        setTokens([]);
        console.log('Disconnected');
      } catch (err) {
        console.log('Disconnection error:', err);
      }
    }
  };

  // Handle checkbox change for selecting a token
  const handleCheckboxChange = (index: number) => {
    const updatedTokens = [...tokens];
    updatedTokens[index].selected = !updatedTokens[index].selected;
    setTokens(updatedTokens);
  };

  // Handle compression of selected tokens
  const compressTokens = async () => {
    const selectedTokens = tokens.filter(token => token.selected);
    if (selectedTokens.length !== 1) {
      alert('Please select exactly one token to compress.');
      return;
    }

    const selectedToken = selectedTokens[0];

    try {
      const provider = getProvider();
      if (!provider || !walletKey) throw new Error('Wallet not connected');

      const payer = Keypair.generate();
      const mint = new PublicKey(selectedToken.mintAddress);
      const publicKey = walletKey!;

      // 1. Check if associated token account exists
      const ata = await getAssociatedTokenAddress(
        mint,
        publicKey,
        false,
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID
      );

      // 2. Create associated token account if it does not exist
      let accountInfo = await connection.getAccountInfo(ata);
      if (!accountInfo) {
        // Create associated token account instruction
        const createAccountIx: TransactionInstruction = createAssociatedTokenAccountInstruction(
          payer.publicKey,
          publicKey,
          mint,
          ASSOCIATED_TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID
        );

        // Create and sign transaction
        const transaction = new Transaction().add(createAccountIx);
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        transaction.feePayer = payer.publicKey;
        await transaction.sign(payer);

        const { signature: txSignature } = await provider.signAndSendTransaction(transaction);
        await connection.confirmTransaction(txSignature);
        console.log('Created associated token account:', ata.toBase58());
      }

      // 3. Transform token accounts data
      const tokenAccountsList = await connection.getParsedTokenAccountsByOwner(publicKey, { mint });
      const parsedAccounts = tokenAccountsList.value.map((accountInfo: any) => ({
        compressedAccount: {
          hash: accountInfo.account.data.parsed.info.mint,
          amount: new BN(accountInfo.account.data.parsed.info.tokenAmount.uiAmountString),
          owner: publicKey,
          lamports: new BN(1),
          address: new PublicKey(accountInfo.pubkey.toString()),
          data: Buffer.alloc(0),
        },
        parsed: accountInfo.account.data.parsed.info,
      }));

      const amount = new BN(1e8);
      const [inputAccounts] = CompressedToken.selectMinCompressedTokenAccountsForTransfer(
        parsedAccounts as any,
        amount,
      );

      if (inputAccounts.length === 0) throw new Error('No input accounts found for compression.');

      const sourceAddress = inputAccounts[0].compressedAccount.address;
      if (!sourceAddress) {
        throw new Error('No source address found for compression.');
      }

      const sourcePublicKey = new PublicKey(sourceAddress.toString());

      // Create compress instruction
      const compressIx: TransactionInstruction = await CompressedToken.CompressedTokenProgram.compress({
        payer: payer.publicKey,
        mint: mint,
        owner: publicKey,
        amount: amount,
        toAddress: publicKey,
        source: sourcePublicKey,
      });

      const transaction = new Transaction().add(compressIx);
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = payer.publicKey;
      await transaction.sign(payer);

      const { signature: txSignature } = await provider.signAndSendTransaction(transaction);
      setSignature(txSignature);
      console.log('Transaction signature:', txSignature);

      await connection.confirmTransaction(txSignature);
      alert('Token successfully compressed.');
    } catch (error) {
      console.error('Compression failed:', error);

      // Attempt to fetch transaction logs if available
      try {
        if (signature) {
          const logs = await connection.getTransaction(signature);
          console.error('Transaction logs:', logs);
        }
      } catch (logError) {
        console.error('Failed to fetch transaction logs:', logError);
      }

      alert('Compression failed. Check the console for details.');
    }
  };

  useEffect(() => {
    const provider = getProvider();
    if (provider) {
      provider.on('connect', (publicKey: PublicKey) => {
        console.log('Connected to wallet:', publicKey.toString());
        setWalletKey(publicKey);
        fetchTokens(publicKey);
      });

      provider.on('disconnect', () => {
        console.log('Disconnected from wallet');
        setWalletKey(null);
        setTokens([]);
      });

      provider.on('accountChange', (publicKey: PublicKey) => {
        if (publicKey) {
          console.log(`Switched to new wallet: ${publicKey.toString()}`);
          setWalletKey(publicKey);
          fetchTokens(publicKey);
        } else {
          console.log('Account changed, but no account is currently connected.');
        }
      });
    }
  }, []);

  return (
    <div>
      {walletKey ? (
        <div>
          <button onClick={disconnectWallet}>Disconnect Wallet</button>
          <div>
            {tokens.map((token, index) => (
              <div key={index}>
                <input
                  type="checkbox"
                  checked={token.selected}
                  onChange={() => handleCheckboxChange(index)}
                />
                {token.mintAddress} - {token.amount}
              </div>
            ))}
          </div>
          <button onClick={compressTokens}>Compress Tokens</button>
        </div>
      ) : (
        <button onClick={connectWallet}>Connect Wallet</button>
      )}
    </div>
  );
};

export default PhantomConnect;
