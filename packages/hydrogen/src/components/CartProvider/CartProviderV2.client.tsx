import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {CartFragmentFragment} from './graphql/CartFragment.js';
import {
  AttributeInput,
  CartBuyerIdentityInput,
  CartInput,
  CartLineInput,
  CartLineUpdateInput,
} from '../../storefront-api-types.js';
import {CartContext} from './context.js';
import {
  CartMachineEvent,
  CartMachineTypeState,
  CartWithActions,
} from './types.js';
import {CartNoteUpdateMutationVariables} from './graphql/CartNoteUpdateMutation.js';
import {useCartActions} from './CartActions.client.js';
import {useCartAPIStateMachine} from './useCartAPIStateMachine.client.js';
import {CART_ID_STORAGE_KEY} from './constants.js';

export function CartProviderV2({
  children,
  numCartLines,
  data: cart,
  cartFragment,
}: {
  /** Any `ReactNode` elements. */
  children: React.ReactNode;
  /**  Maximum number of cart lines to fetch. Defaults to 250 cart lines. */
  numCartLines?: number;
  /** An object with fields that correspond to the Storefront API's [Cart object](https://shopify.dev/api/storefront/latest/objects/cart). */
  data?: CartFragmentFragment;
  /** A fragment used to query the Storefront API's [Cart object](https://shopify.dev/api/storefront/latest/objects/cart) for all queries and mutations. A default value is used if no argument is provided. */
  cartFragment?: string;
}) {
  const {cartFragment: usedCartFragment} = useCartActions({
    numCartLines,
    cartFragment,
  });

  const [cartState, cartSend] = useCartAPIStateMachine({
    numCartLines,
    cartFragment,
  });

  const [cartReady, setCartReady] = useState(false);
  const cartCompleted = cartState.matches('cartCompleted');

  // send cart events when ready
  const onCartReadySend = useCallback(
    (cartEvent: CartMachineEvent) => {
      if (!cartReady) {
        return console.warn("Cart isn't ready yet");
      }
      cartSend(cartEvent);
    },
    [cartReady, cartSend]
  );

  // save cart id to local storage
  useEffect(() => {
    if (cartState?.context?.cart?.id && storageAvailable('localStorage')) {
      try {
        window.localStorage.setItem(
          CART_ID_STORAGE_KEY,
          cartState.context.cart?.id
        );
      } catch (error) {
        console.warn('Failed to save cartId to localStorage', error);
      }
    }
  }, [cartState?.context?.cart?.id]);

  // delete cart from local storage if cart fetched has been completed
  useEffect(() => {
    if (cartCompleted && storageAvailable('localStorage')) {
      try {
        window.localStorage.removeItem(CART_ID_STORAGE_KEY);
      } catch (error) {
        console.warn('Failed to delete cartId from localStorage', error);
      }
    }
  }, [cartCompleted]);

  // fetch cart from local storage if cart id present and set cart as ready for use
  useEffect(() => {
    if (!cartReady && storageAvailable('localStorage')) {
      try {
        const cartId = window.localStorage.getItem(CART_ID_STORAGE_KEY);
        if (cartId) {
          cartSend({type: 'CART_FETCH', payload: {cartId}});
        }
      } catch (error) {
        console.warn('error fetching cartId');
        console.warn(error);
      }
      setCartReady(true);
    }
  }, [cartReady, cartSend]);

  const cartContextValue = useMemo<CartWithActions>(() => {
    return {
      ...(cartState?.context?.cart ?? {lines: [], attributes: []}),
      status: tempTransposeStatus(cartState.value),
      error: cartState?.context?.errors,
      totalQuantity: cartState?.context?.cart?.totalQuantity ?? 0,
      cartCreate(cartInput: CartInput) {
        onCartReadySend({
          type: 'CART_CREATE',
          payload: cartInput,
        });
      },
      linesAdd(lines: CartLineInput[]) {
        onCartReadySend({
          type: 'CARTLINE_ADD',
          payload: {lines},
        });
      },
      linesRemove(lines: string[]) {
        onCartReadySend({
          type: 'CARTLINE_REMOVE',
          payload: {
            lines,
          },
        });
      },
      linesUpdate(lines: CartLineUpdateInput[]) {
        onCartReadySend({
          type: 'CARTLINE_UPDATE',
          payload: {
            lines,
          },
        });
      },
      noteUpdate(note: CartNoteUpdateMutationVariables['note']) {
        onCartReadySend({
          type: 'NOTE_UPDATE',
          payload: {
            note,
          },
        });
      },
      buyerIdentityUpdate(buyerIdentity: CartBuyerIdentityInput) {
        onCartReadySend({
          type: 'BUYER_IDENTITY_UPDATE',
          payload: {
            buyerIdentity,
          },
        });
      },
      cartAttributesUpdate(attributes: AttributeInput[]) {
        onCartReadySend({
          type: 'CART_ATTRIBUTES_UPDATE',
          payload: {
            attributes,
          },
        });
      },
      discountCodesUpdate(discountCodes: string[]) {
        onCartReadySend({
          type: 'DISCOUNT_CODES_UPDATE',
          payload: {
            discountCodes,
          },
        });
      },
      cartFragment: usedCartFragment,
    };
  }, [
    cartState?.context?.cart,
    cartState?.context?.errors,
    cartState.value,
    onCartReadySend,
    usedCartFragment,
  ]);

  return (
    <CartContext.Provider value={cartContextValue}>
      {children}
    </CartContext.Provider>
  );
}

function tempTransposeStatus(
  status: CartMachineTypeState['value']
): CartWithActions['status'] {
  switch (status) {
    case 'uninitialized':
      return 'uninitialized';
    case 'idle':
    case 'cartCompleted':
    case 'error':
    case 'initializationError':
      return 'idle';
    case 'cartFetching':
      return 'fetching';
    case 'cartCreating':
      return 'creating';
    case 'cartLineAdding':
    case 'cartLineRemoving':
    case 'cartLineUpdating':
    case 'noteUpdating':
    case 'buyerIdentityUpdating':
    case 'cartAttributesUpdating':
    case 'discountCodesUpdating':
      return 'updating';
  }
}

/** Check for storage availability funciton obtained from
 * https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API
 */
function storageAvailable(type: 'localStorage' | 'sessionStorage') {
  let storage;
  try {
    storage = window[type];
    const x = '__storage_test__';
    storage.setItem(x, x);
    storage.removeItem(x);
    return true;
  } catch (e) {
    return (
      e instanceof DOMException &&
      // everything except Firefox
      (e.code === 22 ||
        // Firefox
        e.code === 1014 ||
        // test name field too, because code might not be present
        // everything except Firefox
        e.name === 'QuotaExceededError' ||
        // Firefox
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
      // acknowledge QuotaExceededError only if there's something already stored
      storage &&
      storage.length !== 0
    );
  }
}